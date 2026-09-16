from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.catalog_updater import CatalogUpdater
from app.config import Settings
from app.database import CatalogDatabase
from app.main import create_app


class FixedPriority:
    async def get_appids(self) -> list[int]:
        return [570, 10, 730, 440, 550, 4000, 30, 20, 220, 240, 320, 340, 380, 400, 420, 500, 620, 630, 70, 80]


@unittest.skipUnless(os.environ.get("NEXAPLAY_LIVE_INTEGRATION") == "1", "live integration disabled")
class ActualCatalogTests(unittest.TestCase):
    def test_actual_catalog_copy_and_api_payloads(self) -> None:
        source = Path(os.environ["NEXAPLAY_ACTUAL_CATALOG_DB"])
        with tempfile.TemporaryDirectory() as directory:
            copy = Path(directory) / "catalog.sqlite"
            shutil.copy2(source, copy)
            settings = Settings(
                catalog_db=copy,
                priority_cache=Path(directory) / "priority.json",
                trending_path=Path(__file__).resolve().parents[2] / "appid_trending.json",
                display_stats_path=Path(directory) / "display_stats.json",
                allowed_origins=("https://nexaplayid.store",),
            )
            with TestClient(create_app(settings, start_background=False, priority_service=FixedPriority())) as client:
                first_page = client.get("/api/games", params={"page": 1, "limit": 20})
                trending = client.get("/api/games/trending")
                api_stats = client.get("/api/stats")
                by_id = client.get("/api/games", params={"q": "570"})
                by_name = client.get("/api/games", params={"q": "counter strike"})
                premium = client.get("/api/games", params={"tier": "premium", "limit": 1})
                standard = client.get("/api/games", params={"tier": "standard", "limit": 1})
                detail = client.get("/api/games/570")
                for response in [first_page, trending, api_stats, by_id, by_name, premium, standard, detail]:
                    self.assertEqual(response.status_code, 200)
                self.assertLessEqual(len(first_page.json()["items"]), 20)
                self.assertEqual(by_id.json()["items"][0]["appid"], 570)
                self.assertNotIn("price_normalized", detail.json())
                self.assertNotIn("protection", detail.json())

                connection = sqlite3.connect(copy)
                try:
                    has_overrides = connection.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_runtime_overrides'"
                    ).fetchone()
                    if has_overrides:
                        effective_sql = """
                        SELECT g.appid,
                               COALESCE(o.name, g.name),
                               COALESCE(o.library_capsule, g.library_capsule),
                               COALESCE(o.genre, g.genre),
                               COALESCE(o.tier, g.tier),
                               g.pc_requirements
                        FROM games g
                        LEFT JOIN catalog_runtime_overrides o ON o.appid = g.appid
                        WHERE g.appid=?
                        """
                    else:
                        effective_sql = """
                        SELECT appid, name, library_capsule, genre, tier, pc_requirements
                        FROM games
                        WHERE appid=?
                        """
                    expected_detail = connection.execute(
                        effective_sql,
                        (570,),
                    ).fetchone()
                    expected_requirements = json.loads(expected_detail[5])
                    self.assertEqual(detail.json(), {
                        "appid": expected_detail[0],
                        "name": expected_detail[1],
                        "library_capsule": (expected_detail[2] or "").strip(),
                        "genre": json.loads(expected_detail[3]),
                        "tier": expected_detail[4],
                        "pc_requirements": {
                            "minimum": expected_requirements.get("minimum", "").strip() if isinstance(expected_requirements.get("minimum"), str) else "",
                            "recommended": expected_requirements.get("recommended", "").strip() if isinstance(expected_requirements.get("recommended"), str) else "",
                        },
                    })
                    stats = connection.execute(
                    """
                    SELECT COUNT(*),
                           SUM(tier='premium'),
                           SUM(tier='standard'),
                           SUM(library_capsule IS NOT NULL AND LENGTH(TRIM(library_capsule)) > 0),
                           SUM(json_valid(genre) AND json_type(genre)='array' AND json_array_length(genre) > 0),
                           SUM(json_valid(pc_requirements) AND (
                               LENGTH(TRIM(COALESCE(json_extract(pc_requirements, '$.minimum'), ''))) > 0 OR
                               LENGTH(TRIM(COALESCE(json_extract(pc_requirements, '$.recommended'), ''))) > 0
                           ))
                    FROM games
                    """
                    ).fetchone()
                    samples = {
                    "premium": connection.execute("SELECT appid FROM games WHERE tier='premium' ORDER BY appid LIMIT 1").fetchone()[0],
                    "standard": connection.execute("SELECT appid FROM games WHERE tier='standard' ORDER BY appid LIMIT 1").fetchone()[0],
                    "missing_cover": connection.execute("SELECT appid FROM games WHERE library_capsule IS NULL OR TRIM(library_capsule)='' ORDER BY appid LIMIT 1").fetchone()[0],
                    "missing_genre": connection.execute("SELECT appid FROM games WHERE json_valid(genre) AND json_array_length(genre)=0 ORDER BY appid LIMIT 1").fetchone()[0],
                    "missing_requirements": connection.execute(
                        """
                        SELECT appid FROM games
                        WHERE json_valid(pc_requirements)
                          AND LENGTH(TRIM(COALESCE(json_extract(pc_requirements, '$.minimum'), '')))=0
                          AND LENGTH(TRIM(COALESCE(json_extract(pc_requirements, '$.recommended'), '')))=0
                        ORDER BY appid LIMIT 1
                        """
                    ).fetchone()[0],
                    }
                    for sample_appid in samples.values():
                        response = client.get(f"/api/games/{sample_appid}")
                        self.assertEqual(response.status_code, 200)
                        expected = connection.execute(
                            effective_sql,
                            (sample_appid,),
                        ).fetchone()
                        raw_genre = json.loads(expected[3])
                        raw_requirements = json.loads(expected[5])
                        self.assertEqual(response.json(), {
                            "appid": expected[0],
                            "name": expected[1],
                            "library_capsule": (expected[2] or "").strip(),
                            "genre": [item.strip() for item in raw_genre if isinstance(item, str) and item.strip()],
                            "tier": expected[4],
                            "pc_requirements": {
                                "minimum": raw_requirements.get("minimum", "").strip() if isinstance(raw_requirements.get("minimum"), str) else "",
                                "recommended": raw_requirements.get("recommended", "").strip() if isinstance(raw_requirements.get("recommended"), str) else "",
                            },
                        })
                finally:
                    connection.close()
                print(json.dumps({
                    "stats": {
                        "total": stats[0],
                        "premium": stats[1],
                        "standard": stats[2],
                        "cover_nonempty": stats[3],
                        "genre_nonempty": stats[4],
                        "requirements_nonempty": stats[5],
                    },
                    "samples": samples,
                    "first_page_bytes": len(first_page.content),
                    "trending_bytes": len(trending.content),
                    "initial_api_bytes": len(first_page.content) + len(trending.content) + len(api_stats.content),
                }, separators=(",", ":")))

    def test_live_manifest_updates_seed_copy(self) -> None:
        source = Path(os.environ["NEXAPLAY_SEED_CATALOG_DB"])
        with tempfile.TemporaryDirectory() as directory:
            copy = Path(directory) / "catalog.sqlite"
            shutil.copy2(source, copy)
            updater = CatalogUpdater(
                CatalogDatabase(copy),
                "https://meta.nexaplaymetadata.online/catalog/catalog_manifest.json",
                20,
            )
            result = updater.check_and_apply()
            self.assertEqual(result.status, "Applied")
            self.assertEqual((result.initial_version, result.current_version, result.applied), (2, 4, 2))


if __name__ == "__main__":
    unittest.main()
