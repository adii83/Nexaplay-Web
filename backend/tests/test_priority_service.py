from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from app.priority_service import HttpResult, PriorityService, PriorityUnavailable


class PriorityServiceTests(unittest.TestCase):
    def test_valid_remote_is_cached_and_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            calls = []

            def fetcher(url, headers, timeout):
                calls.append((url, headers, timeout))
                return HttpResult(200, b'[30,10,30,-1,"bad"]', {"ETag": '"v1"'})

            cache = Path(directory) / "priority.json"
            service = PriorityService(
                url="https://example.test/appid_populer.json",
                cache_path=cache,
                refresh_seconds=300,
                timeout_seconds=2,
                fetcher=fetcher,
            )
            self.assertEqual(asyncio.run(service.get_appids()), [30, 10])
            self.assertEqual(json.loads(cache.read_text())["appids"], [30, 10])
            self.assertEqual(len(calls), 1)

    def test_last_known_good_survives_network_and_invalid_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "priority.json"
            cache.write_text(json.dumps({"appids": [10, 20], "etag": '"old"'}), encoding="utf-8")

            def failing(*_):
                raise OSError("offline")

            service = PriorityService(
                url="https://example.test/appid_populer.json",
                cache_path=cache,
                refresh_seconds=300,
                timeout_seconds=2,
                fetcher=failing,
            )
            self.assertEqual(asyncio.run(service.get_appids()), [10, 20])

            service._last_checked = 0
            service.fetcher = lambda *_: HttpResult(200, b'{"not":"an array"}', {})
            self.assertEqual(asyncio.run(service.get_appids()), [10, 20])
            self.assertEqual(json.loads(cache.read_text())["appids"], [10, 20])

    def test_unavailable_without_remote_or_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            service = PriorityService(
                url="",
                cache_path=Path(directory) / "missing.json",
                refresh_seconds=300,
                timeout_seconds=2,
            )
            with self.assertRaises(PriorityUnavailable):
                asyncio.run(service.get_appids())

    def test_concurrent_callers_share_one_fetch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            calls = 0

            def fetcher(*_):
                nonlocal calls
                calls += 1
                return HttpResult(200, b"[10,20]", {})

            service = PriorityService(
                url="https://example.test/appid_populer.json",
                cache_path=Path(directory) / "priority.json",
                refresh_seconds=300,
                timeout_seconds=2,
                fetcher=fetcher,
            )

            async def run():
                return await asyncio.gather(*(service.get_appids() for _ in range(8)))

            self.assertEqual(asyncio.run(run()), [[10, 20]] * 8)
            self.assertEqual(calls, 1)


if __name__ == "__main__":
    unittest.main()
