from __future__ import annotations

import tempfile
import unittest
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.priority_service import PriorityUnavailable
from tests.helpers import create_catalog


class FakePriority:
    async def get_appids(self) -> list[int]:
        return [10, 40, 20, 999]


class UnavailablePriority:
    async def get_appids(self) -> list[int]:
        raise PriorityUnavailable("not configured")


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "catalog.sqlite"
        create_catalog(self.db_path, version=4)
        connection = sqlite3.connect(self.db_path)
        try:
            connection.execute(
                "INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?,?)",
                (40, "Alpha Game", "alpha game", "https://example.test/40.jpg", "[]", 0, "Free", 0, "standard", "{}"),
            )
            connection.commit()
        finally:
            connection.close()
        self.trending_path = Path(self.temp.name) / "appid_trending.json"
        self.trending_path.write_text("[30,10,999]", encoding="utf-8")
        settings = Settings(
            catalog_db=self.db_path,
            priority_cache=Path(self.temp.name) / "priority.json",
            trending_path=self.trending_path,
            display_stats_path=Path(self.temp.name) / "display_stats.json",
            allowed_origins=("https://nexaplayid.store",),
        )
        self.client = TestClient(
            create_app(settings, start_background=False, priority_service=FakePriority())
        )

    def tearDown(self) -> None:
        self.client.close()
        self.temp.cleanup()

    def test_first_page_pagination_and_limit_bounds(self) -> None:
        response = self.client.get("/api/games", params={"limit": 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 2)
        self.assertEqual([item["appid"] for item in response.json()["items"]], [10])
        page_two = self.client.get("/api/games", params={"page": 2, "limit": 1})
        self.assertEqual([item["appid"] for item in page_two.json()["items"]], [40])
        self.assertEqual(self.client.get("/api/games", params={"limit": 0}).status_code, 422)
        self.assertEqual(self.client.get("/api/games", params={"limit": 61}).status_code, 422)
        self.assertEqual(self.client.get("/api/games", params={"page": 0}).status_code, 422)

    def test_tier_and_search_queries(self) -> None:
        premium = self.client.get("/api/games", params={"tier": "premium"}).json()
        standard = self.client.get("/api/games", params={"tier": "standard"}).json()
        by_id = self.client.get("/api/games", params={"q": "10"}).json()
        by_name = self.client.get("/api/games", params={"q": "Cafe"}).json()
        by_name_tier = self.client.get("/api/games", params={"q": "Cafe", "tier": "premium"}).json()
        self.assertEqual(premium["items"], [])
        self.assertEqual([item["appid"] for item in standard["items"]], [10, 40])
        self.assertEqual([item["appid"] for item in by_id["items"]], [10])
        self.assertEqual([item["appid"] for item in by_name["items"]], [20])
        self.assertEqual([item["appid"] for item in by_name_tier["items"]], [20])
        self.assertEqual(by_name["total"], 1)
        self.assertEqual(self.client.get("/api/games", params={"tier": "gold"}).status_code, 422)

    def test_detail_types_missing_and_private_fields(self) -> None:
        detail = self.client.get("/api/games/10")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["genre"], ["Action"])
        self.assertEqual(detail.json()["pc_requirements"]["minimum"], "Windows")
        self.assertNotIn("price_normalized", detail.json())
        self.assertNotIn("price_display", detail.json())
        self.assertNotIn("protection", detail.json())
        self.assertNotIn("publisher", detail.json())
        malformed = self.client.get("/api/games/20").json()
        self.assertEqual(malformed["library_capsule"], "")
        self.assertEqual(malformed["genre"], [])
        self.assertEqual(malformed["pc_requirements"], {"minimum": "", "recommended": ""})
        self.assertEqual(self.client.get("/api/games/999").status_code, 404)
        self.assertEqual(self.client.get("/api/games/0").status_code, 422)

    def test_ids_order_duplicates_missing_and_validation(self) -> None:
        response = self.client.get("/api/games", params={"ids": "30,10,30,999"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["appid"] for item in response.json()["items"]], [30, 10])
        self.assertEqual(self.client.get("/api/games", params={"ids": "10,nope"}).status_code, 422)
        self.assertEqual(self.client.get("/api/games", params={"ids": "10", "q": "game"}).status_code, 422)
        too_many = ",".join(str(value) for value in range(1, 102))
        self.assertEqual(self.client.get("/api/games", params={"ids": too_many}).status_code, 422)

    def test_trending_stats_health_and_cors(self) -> None:
        trending = self.client.get("/api/games/trending")
        self.assertEqual([item["appid"] for item in trending.json()], [30, 10])
        self.assertEqual(trending.json()[0]["library_capsule"], "")
        database_before = self.db_path.read_bytes()
        stats = self.client.get("/api/stats")
        self.assertEqual(self.db_path.read_bytes(), database_before)
        self.assertEqual(stats.json()["actual_count"], 4)
        self.assertGreaterEqual(stats.json()["display_count"], 4)
        self.assertEqual(stats.headers["cache-control"], "public, max-age=180")
        health = self.client.get("/api/health").json()
        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["catalog_version"], 4)
        cors = self.client.options(
            "/api/games",
            headers={
                "Origin": "https://nexaplayid.store",
                "Access-Control-Request-Method": "GET",
            },
        )
        self.assertEqual(cors.headers["access-control-allow-origin"], "https://nexaplayid.store")
        denied = self.client.options(
            "/api/games",
            headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "GET"},
        )
        self.assertNotIn("access-control-allow-origin", denied.headers)

    def test_priority_failure_does_not_break_catalog(self) -> None:
        settings = Settings(
            catalog_db=self.db_path,
            priority_cache=Path(self.temp.name) / "missing.json",
            trending_path=self.trending_path,
            display_stats_path=Path(self.temp.name) / "other_stats.json",
            allowed_origins=("https://nexaplayid.store",),
        )
        with TestClient(
            create_app(settings, start_background=False, priority_service=UnavailablePriority())
        ) as client:
            self.assertEqual(client.get("/api/games").status_code, 200)


if __name__ == "__main__":
    unittest.main()
