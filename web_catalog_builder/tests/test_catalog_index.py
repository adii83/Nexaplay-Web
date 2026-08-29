import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from web_catalog_builder import build_index
from web_catalog_builder.catalog_index import (
    build_search_rows,
    compact_cover_url,
    existing_cover_map,
)


class CatalogIndexTests(unittest.TestCase):
    def test_compact_cover_preserves_hash_path_and_query(self):
        url = (
            "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"
            "4659280/e6669/library_capsule_2x.jpg?t=1777111910"
        )
        self.assertEqual(
            compact_cover_url(url),
            "4659280/e6669/library_capsule_2x.jpg?t=1777111910",
        )

    def test_compact_cover_supports_known_prefixes_and_absolute_urls(self):
        suffix = "30/library_600x900.jpg?t=1"
        prefixes = (
            "https://shared.steamstatic.com/store_item_assets/steam/apps/",
            "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/",
            "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/",
        )
        for prefix in prefixes:
            with self.subTest(prefix=prefix):
                self.assertEqual(compact_cover_url(prefix + suffix), suffix)
        absolute_url = "https://cdn.example.com/covers/30.jpg?version=2"
        self.assertEqual(compact_cover_url(absolute_url), absolute_url)

    def test_compact_cover_normalizes_missing_values(self):
        for value in (None, "", "   ", "NO CONTENT", " NO CONTENT "):
            with self.subTest(value=value):
                self.assertEqual(compact_cover_url(value), "")

    def test_existing_cover_map_accepts_four_and_five_field_rows(self):
        rows = [
            [10, "Four", 0, "10/four.jpg"],
            [20, "Five", 1, "20/five.jpg?t=1", 3],
            ["bad", "Ignored", 0, "bad.jpg"],
            [30, "Short"],
        ]
        self.assertEqual(
            existing_cover_map(rows),
            {10: "10/four.jpg", 20: "20/five.jpg?t=1"},
        )

    def test_existing_cover_map_rejects_duplicate_integer_appids(self):
        rows = [
            [10, "Four", 0, "10/four.jpg"],
            [10, "Five", 1, "10/five.jpg?t=1", 3],
        ]
        with self.assertRaisesRegex(ValueError, "duplicate AppID: 10"):
            existing_cover_map(rows)

    def test_build_rows_preserves_old_cover_during_migration(self):
        games = [
            {"appid": 30, "title": "Day of Defeat", "premium": False, "header": ""}
        ]
        old_rows = [[30, "Day of Defeat", 0, "30/library_600x900.jpg?t=1", 1]]
        self.assertEqual(
            build_search_rows(games, old_rows),
            [[30, "Day of Defeat", 0, "30/library_600x900.jpg?t=1"]],
        )

    def test_build_rows_uses_cover_then_old_cover_then_header_in_input_order(self):
        games = [
            {
                "appid": 3,
                "title": "Cover",
                "premium": True,
                "cover_url": "https://cdn.example.com/3.jpg",
                "header": "https://cdn.example.com/header-3.jpg",
            },
            {
                "appid": 1,
                "title": "Header",
                "premium": False,
                "cover_url": "NO CONTENT",
                "header": (
                    "https://shared.steamstatic.com/store_item_assets/steam/apps/"
                    "1/header.jpg"
                ),
            },
            {
                "appid": 2,
                "title": "Old",
                "premium": 0,
                "header": "https://cdn.example.com/header-2.jpg",
            },
        ]
        old_rows = [[2, "Old", 0, "2/old.jpg", 7]]
        self.assertEqual(
            build_search_rows(games, old_rows),
            [
                [3, "Cover", 1, "https://cdn.example.com/3.jpg"],
                [1, "Header", 0, "1/header.jpg"],
                [2, "Old", 0, "2/old.jpg"],
            ],
        )

    def test_build_rows_rejects_invalid_premium_values(self):
        for premium in ("false", "true", None, 2, -1, 0.0, [], {}):
            with self.subTest(premium=premium):
                with self.assertRaises(ValueError):
                    build_search_rows(
                        [{"appid": 30, "title": "Game", "premium": premium}],
                        [],
                    )

    def test_build_rows_accepts_boolean_and_integer_premium_values(self):
        games = [
            {"appid": 1, "title": "False", "premium": False},
            {"appid": 2, "title": "True", "premium": True},
            {"appid": 3, "title": "Zero", "premium": 0},
            {"appid": 4, "title": "One", "premium": 1},
        ]
        self.assertEqual(
            [row[2] for row in build_search_rows(games, [])],
            [0, 1, 0, 1],
        )

    def test_build_rows_rejects_invalid_or_duplicate_appids_and_empty_titles(self):
        invalid_games = (
            [{"appid": "30", "title": "String ID", "premium": False}],
            [{"appid": "not-an-appid", "title": "String ID", "premium": False}],
            [{"appid": "30.0", "title": "Decimal ID", "premium": False}],
            [{"appid": 30.5, "title": "Float ID", "premium": False}],
            [{"appid": True, "title": "Boolean ID", "premium": False}],
            [{"appid": 0, "title": "Zero ID", "premium": False}],
            [{"appid": -1, "title": "Negative ID", "premium": False}],
            [{"appid": 30, "title": " ", "premium": False}],
            [
                {"appid": 30, "title": "First", "premium": False},
                {"appid": "30", "title": "Second", "premium": True},
            ],
        )
        for games in invalid_games:
            with self.subTest(games=games):
                with self.assertRaises(ValueError):
                    build_search_rows(games, [])


class BuildIndexCliTests(unittest.TestCase):
    SCRIPT = Path(__file__).resolve().parents[1] / "build_index.py"

    def test_check_validates_without_writing_output(self):
        games = [
            {"appid": 2, "title": "Second", "premium": True, "header": ""},
            {"appid": 1, "title": "First", "premium": False, "header": ""},
        ]
        old_rows = [[2, "Second", 1, "2/old.jpg", 1]]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            games_path = root / "games.json"
            old_path = root / "old.json"
            output_path = root / "new.json"
            games_path.write_text(json.dumps(games), encoding="utf-8")
            old_path.write_text(json.dumps(old_rows), encoding="utf-8")

            result = subprocess.run(
                [
                    sys.executable,
                    str(self.SCRIPT),
                    "--games-list",
                    str(games_path),
                    "--existing-index",
                    str(old_path),
                    "--output",
                    str(output_path),
                    "--check",
                ],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("2 unique games", result.stdout)
            self.assertIn("four-field tuples", result.stdout)
            self.assertFalse(output_path.exists())
            self.assertFalse(output_path.with_suffix(output_path.suffix + ".tmp").exists())

    def test_normal_mode_writes_four_field_index_atomically(self):
        games = [{"appid": 2, "title": "Second", "premium": True, "header": ""}]
        old_rows = [[2, "Second", 1, "2/old.jpg", 1]]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            games_path = root / "games.json"
            old_path = root / "old.json"
            output_path = root / "nested" / "index.json"
            games_path.write_text(json.dumps(games), encoding="utf-8")
            old_path.write_text(json.dumps(old_rows), encoding="utf-8")

            result = subprocess.run(
                [
                    sys.executable,
                    str(self.SCRIPT),
                    "--games-list",
                    str(games_path),
                    "--existing-index",
                    str(old_path),
                    "--output",
                    str(output_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                json.loads(output_path.read_text(encoding="utf-8")),
                [[2, "Second", 1, "2/old.jpg"]],
            )
            self.assertFalse(output_path.with_suffix(output_path.suffix + ".tmp").exists())

    def test_check_fails_when_existing_appid_disappears_even_without_cover(self):
        games = [{"appid": 2, "title": "Second", "premium": True, "header": ""}]
        old_rows = [
            [1, "First", 0, "", 1],
            [2, "Second", 1, "", 1],
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            games_path = root / "games.json"
            old_path = root / "old.json"
            output_path = root / "new.json"
            games_path.write_text(json.dumps(games), encoding="utf-8")
            old_path.write_text(json.dumps(old_rows), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "existing AppID 1 disappeared"):
                build_index.build_index(
                    games_path,
                    old_path,
                    output_path,
                    check=True,
                )

            self.assertFalse(output_path.exists())

    def test_check_accepts_all_existing_appids_with_empty_covers(self):
        games = [
            {"appid": 1, "title": "First", "premium": False, "header": ""},
            {"appid": 2, "title": "Second", "premium": True, "header": ""},
        ]
        old_rows = [
            [1, "First", 0, "", 1],
            [2, "Second", 1, "", 1],
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            games_path = root / "games.json"
            old_path = root / "old.json"
            output_path = root / "new.json"
            games_path.write_text(json.dumps(games), encoding="utf-8")
            old_path.write_text(json.dumps(old_rows), encoding="utf-8")

            rows = build_index.build_index(
                games_path,
                old_path,
                output_path,
                check=True,
            )

            self.assertEqual([row[0] for row in rows], [1, 2])
            self.assertFalse(output_path.exists())

    def test_check_treats_old_no_content_cover_as_empty(self):
        games = [{"appid": 2, "title": "Second", "premium": True, "header": ""}]
        old_rows = [[2, "Second", 1, "  NO CONTENT  ", 1]]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            games_path = root / "games.json"
            old_path = root / "old.json"
            output_path = root / "new.json"
            games_path.write_text(json.dumps(games), encoding="utf-8")
            old_path.write_text(json.dumps(old_rows), encoding="utf-8")

            rows = build_index.build_index(
                games_path,
                old_path,
                output_path,
                check=True,
            )

            self.assertEqual(rows, [[2, "Second", 1, ""]])
            self.assertFalse(output_path.exists())

    def test_check_fails_when_existing_cover_is_lost(self):
        games = [{"appid": 2, "title": "Second", "premium": True, "header": ""}]
        old_rows = [[2, "Second", 1, "2/old.jpg", 1]]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            games_path = root / "games.json"
            old_path = root / "old.json"
            output_path = root / "new.json"
            games_path.write_text(json.dumps(games), encoding="utf-8")
            old_path.write_text(json.dumps(old_rows), encoding="utf-8")

            with mock.patch(
                "web_catalog_builder.build_index.build_search_rows",
                return_value=[[2, "Second", 1, ""]],
            ):
                with self.assertRaisesRegex(ValueError, "lost existing cover"):
                    build_index.build_index(
                        games_path,
                        old_path,
                        output_path,
                        check=True,
                    )

            self.assertFalse(output_path.exists())

    def test_missing_existing_index_fails(self):
        games = [{"appid": 2, "title": "Second", "premium": True, "header": ""}]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            games_path = root / "games.json"
            output_path = root / "new.json"
            games_path.write_text(json.dumps(games), encoding="utf-8")

            result = subprocess.run(
                [
                    sys.executable,
                    str(self.SCRIPT),
                    "--games-list",
                    str(games_path),
                    "--existing-index",
                    str(root / "missing.json"),
                    "--output",
                    str(output_path),
                    "--check",
                ],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing.json", result.stderr)
            self.assertFalse(output_path.exists())

    def test_atomic_writes_use_unique_sibling_temp_files(self):
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "index.json"
            real_factory = tempfile.NamedTemporaryFile
            temp_paths = []

            def recording_factory(*args, **kwargs):
                temporary = real_factory(*args, **kwargs)
                temp_paths.append(Path(temporary.name))
                return temporary

            with mock.patch.object(
                build_index.tempfile,
                "NamedTemporaryFile",
                side_effect=recording_factory,
            ):
                build_index.write_json_atomic(output_path, [[1]])
                build_index.write_json_atomic(output_path, [[2]])

            self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")), [[2]])
            self.assertEqual(len(temp_paths), 2)
            self.assertEqual(len(set(temp_paths)), 2)
            self.assertTrue(all(path.parent == output_path.parent for path in temp_paths))
            self.assertTrue(all(not path.exists() for path in temp_paths))

    def test_atomic_write_cleans_unique_temp_file_when_replace_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "index.json"
            created_path = None
            real_factory = tempfile.NamedTemporaryFile

            def recording_factory(*args, **kwargs):
                nonlocal created_path
                temporary = real_factory(*args, **kwargs)
                created_path = Path(temporary.name)
                return temporary

            with mock.patch.object(
                build_index.tempfile,
                "NamedTemporaryFile",
                side_effect=recording_factory,
            ), mock.patch.object(
                build_index.os,
                "replace",
                side_effect=OSError("replace failed"),
            ):
                with self.assertRaisesRegex(OSError, "replace failed"):
                    build_index.write_json_atomic(output_path, [[1]])

            self.assertIsNotNone(created_path)
            self.assertFalse(created_path.exists())
            self.assertFalse(output_path.exists())


if __name__ == "__main__":
    unittest.main()
