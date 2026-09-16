from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.stats_service import DisplayStatsService


class DisplayStatsServiceTests(unittest.TestCase):
    def test_elapsed_hours_and_monotonic_rebase(self) -> None:
        anchor = datetime(2026, 9, 16, 15, tzinfo=timezone.utc)
        current = [anchor]
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "display_stats.json"
            state.write_text(
                json.dumps({"base_count": 100, "anchor_time": anchor.isoformat()}),
                encoding="utf-8",
            )
            service = DisplayStatsService(state, now=lambda: current[0])

            self.assertEqual(service.counts(90), (90, 100))
            current[0] = anchor + timedelta(minutes=59)
            self.assertEqual(service.counts(90), (90, 100))
            current[0] = anchor + timedelta(hours=1)
            self.assertEqual(service.counts(90), (90, 101))
            current[0] = anchor + timedelta(hours=24)
            self.assertEqual(service.counts(90), (90, 124))

            self.assertEqual(service.counts(130), (130, 130))
            rebased = json.loads(state.read_text(encoding="utf-8"))
            self.assertEqual(rebased["base_count"], 130)
            current[0] = anchor + timedelta(hours=23)
            self.assertEqual(service.counts(90), (90, 130))


if __name__ == "__main__":
    unittest.main()
