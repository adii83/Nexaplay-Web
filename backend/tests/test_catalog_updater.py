from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.catalog_updater import CatalogUpdater, Download
from app.database import CatalogDatabase
from tests.helpers import create_catalog, patch_row


MANIFEST_URL = "https://meta.example.test/catalog/catalog_manifest.json"


def encoded_patch(from_version: int, to_version: int, upsert=None, delete=None, schema=1) -> bytes:
    return json.dumps(
        {
            "schema_version": schema,
            "from_version": from_version,
            "to_version": to_version,
            "upsert": upsert or [],
            "delete": delete or [],
        },
        separators=(",", ":"),
    ).encode()


def manifest_bytes(latest: int, minimum: int, patches: list[tuple[int, bytes]]) -> bytes:
    return json.dumps(
        {
            "schema_version": 1,
            "latest_version": latest,
            "minimum_supported_version": minimum,
            "generated_at": "test",
            "patches": [
                {
                    "version": version,
                    "file": f"patches/{version}.json",
                    "size": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                }
                for version, body in patches
            ],
        },
        separators=(",", ":"),
    ).encode()


class UpdaterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "catalog.sqlite"
        create_catalog(self.path, 2)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def updater(self, manifest: bytes, patches: dict[int, bytes]) -> CatalogUpdater:
        resources = {MANIFEST_URL: manifest}
        resources.update(
            {f"https://meta.example.test/catalog/patches/{version}.json": body for version, body in patches.items()}
        )

        def downloader(url: str, _: float) -> Download:
            if url not in resources:
                raise OSError(f"missing fixture {url}")
            return Download(resources[url], {})

        return CatalogUpdater(CatalogDatabase(self.path), MANIFEST_URL, 2, downloader)

    def version(self) -> int:
        return CatalogDatabase(self.path).catalog_version()

    def test_no_change_local_ahead_and_unsupported_baseline(self) -> None:
        no_change = self.updater(manifest_bytes(2, 2, []), {}).check_and_apply()
        self.assertEqual(no_change.status, "NoChange")
        ahead = self.updater(manifest_bytes(1, 1, []), {}).check_and_apply()
        self.assertEqual(ahead.status, "LocalAhead")
        unsupported = self.updater(manifest_bytes(4, 3, []), {}).check_and_apply()
        self.assertEqual(unsupported.status, "UnsupportedBaseline")
        self.assertEqual(self.version(), 2)

    def test_sequential_patches_apply_all_columns(self) -> None:
        patch3 = encoded_patch(2, 3, [patch_row(10, name="Updated Ten")])
        patch4 = encoded_patch(3, 4, [patch_row(40)], [30])
        result = self.updater(manifest_bytes(4, 2, [(3, patch3), (4, patch4)]), {3: patch3, 4: patch4}).check_and_apply()
        self.assertEqual((result.status, result.current_version, result.applied), ("Applied", 4, 2))
        connection = sqlite3.connect(self.path)
        row = connection.execute("SELECT * FROM games WHERE appid=40").fetchone()
        self.assertEqual(row, (40, "Game 40", "game 40", "https://example.test/40.jpg", '["Action"]', 345678, "Rp 345.678", 1, "premium", '{"minimum":"min","recommended":"rec"}'))
        self.assertIsNone(connection.execute("SELECT 1 FROM games WHERE appid=30").fetchone())
        connection.close()

    def test_size_sha_schema_from_and_missing_chain_fail(self) -> None:
        patch3 = encoded_patch(2, 3)
        manifest = json.loads(manifest_bytes(3, 2, [(3, patch3)]))
        manifest["schema_version"] = 2
        self.assertEqual(self.updater(json.dumps(manifest).encode(), {3: patch3}).check_and_apply().status, "Failed")
        manifest["schema_version"] = 1
        manifest["patches"][0]["size"] += 1
        self.assertEqual(self.updater(json.dumps(manifest).encode(), {3: patch3}).check_and_apply().status, "Failed")
        manifest["patches"][0]["size"] = len(patch3)
        manifest["patches"][0]["sha256"] = "0" * 64
        self.assertEqual(self.updater(json.dumps(manifest).encode(), {3: patch3}).check_and_apply().status, "Failed")
        wrong_schema = encoded_patch(2, 3, schema=2)
        self.assertEqual(self.updater(manifest_bytes(3, 2, [(3, wrong_schema)]), {3: wrong_schema}).check_and_apply().status, "Failed")
        wrong_from = encoded_patch(1, 2)
        self.assertEqual(self.updater(manifest_bytes(3, 2, [(3, wrong_from)]), {3: wrong_from}).check_and_apply().status, "Failed")
        self.assertEqual(self.updater(manifest_bytes(4, 2, [(4, encoded_patch(3, 4))]), {}).check_and_apply().status, "Failed")
        self.assertEqual(self.version(), 2)

    def test_duplicate_and_conflicting_rows_fail(self) -> None:
        duplicate = encoded_patch(2, 3, [patch_row(40), patch_row(40)])
        conflict = encoded_patch(2, 3, [patch_row(40)], [40])
        self.assertEqual(self.updater(manifest_bytes(3, 2, [(3, duplicate)]), {3: duplicate}).check_and_apply().status, "Failed")
        self.assertEqual(self.updater(manifest_bytes(3, 2, [(3, conflict)]), {3: conflict}).check_and_apply().status, "Failed")
        self.assertEqual(self.version(), 2)

    def test_sql_failure_rolls_back_current_patch(self) -> None:
        connection = sqlite3.connect(self.path)
        connection.execute("CREATE TRIGGER fail_99 BEFORE INSERT ON games WHEN NEW.appid=99 BEGIN SELECT RAISE(ABORT, 'fixture failure'); END")
        connection.commit()
        connection.close()
        patch3 = encoded_patch(2, 3, [patch_row(40), patch_row(99)])
        result = self.updater(manifest_bytes(3, 2, [(3, patch3)]), {3: patch3}).check_and_apply()
        self.assertEqual(result.status, "Failed")
        self.assertEqual(self.version(), 2)
        connection = sqlite3.connect(self.path)
        self.assertIsNone(connection.execute("SELECT 1 FROM games WHERE appid=40").fetchone())
        connection.close()

    def test_previous_patch_stays_committed_when_next_fails(self) -> None:
        connection = sqlite3.connect(self.path)
        connection.execute("CREATE TRIGGER fail_99 BEFORE INSERT ON games WHEN NEW.appid=99 BEGIN SELECT RAISE(ABORT, 'fixture failure'); END")
        connection.commit()
        connection.close()
        patch3 = encoded_patch(2, 3, [patch_row(40)])
        patch4 = encoded_patch(3, 4, [patch_row(99)])
        result = self.updater(manifest_bytes(4, 2, [(3, patch3), (4, patch4)]), {3: patch3, 4: patch4}).check_and_apply()
        self.assertEqual((result.status, result.current_version, result.applied), ("Failed", 3, 1))
        connection = sqlite3.connect(self.path)
        self.assertIsNotNone(connection.execute("SELECT 1 FROM games WHERE appid=40").fetchone())
        self.assertIsNone(connection.execute("SELECT 1 FROM games WHERE appid=99").fetchone())
        connection.close()


if __name__ == "__main__":
    unittest.main()
