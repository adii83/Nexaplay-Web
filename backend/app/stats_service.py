from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


class DisplayStatsService:
    def __init__(self, state_path: Path, now: Callable[[], datetime] | None = None):
        self.state_path = state_path
        self.now = now or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._last_display = 0

    @staticmethod
    def _parse_time(value: object) -> datetime:
        if not isinstance(value, str):
            raise ValueError("anchor_time must be an ISO timestamp")
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("anchor_time must include a timezone")
        return parsed.astimezone(timezone.utc)

    def _load(self) -> tuple[int, datetime] | None:
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
            base_count = payload["base_count"]
            if not isinstance(base_count, int) or isinstance(base_count, bool) or base_count < 0:
                raise ValueError("base_count must be a non-negative integer")
            return base_count, self._parse_time(payload["anchor_time"])
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def _write(self, base_count: int, anchor_time: datetime) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {
                "base_count": base_count,
                "anchor_time": anchor_time.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            },
            separators=(",", ":"),
        )
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{self.state_path.name}.",
            dir=self.state_path.parent,
            text=True,
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.state_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def counts(self, actual_count: int) -> tuple[int, int]:
        with self._lock:
            now = self.now().astimezone(timezone.utc)
            state = self._load()
            if state is None:
                base_count, anchor_time = actual_count, now
                self._write(base_count, anchor_time)
            else:
                base_count, anchor_time = state

            elapsed_hours = max(0, int((now - anchor_time).total_seconds() // 3600))
            projected = base_count + elapsed_hours
            if actual_count > projected:
                base_count, anchor_time, projected = actual_count, now, actual_count
                self._write(base_count, anchor_time)

            display_count = max(actual_count, projected, self._last_display)
            self._last_display = display_count
            return actual_count, display_count
