from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping


LOG = logging.getLogger(__name__)


@dataclass(frozen=True)
class HttpResult:
    status: int
    body: bytes
    headers: Mapping[str, str]


class PriorityUnavailable(RuntimeError):
    pass


def fetch_http(url: str, headers: Mapping[str, str], timeout: float) -> HttpResult:
    request = urllib.request.Request(url, headers={**headers, "User-Agent": "NexaPlay-Web-API/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return HttpResult(response.status, response.read(), dict(response.headers.items()))
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return HttpResult(304, b"", dict(error.headers.items()))
        raise


class PriorityService:
    def __init__(
        self,
        *,
        url: str,
        cache_path: Path,
        refresh_seconds: int,
        timeout_seconds: float,
        fetcher: Callable[[str, Mapping[str, str], float], HttpResult] = fetch_http,
    ):
        self.url = url
        self.cache_path = cache_path
        self.refresh_seconds = refresh_seconds
        self.timeout_seconds = timeout_seconds
        self.fetcher = fetcher
        self._lock = asyncio.Lock()
        self._last_checked = 0.0
        self._appids: list[int] = []
        self._etag = ""
        self._last_modified = ""
        self._load_cache()

    def _load_cache(self) -> None:
        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
            appids, _ = self._validate(payload.get("appids"))
            if not appids:
                return
            self._appids = appids
            self._etag = payload.get("etag", "") if isinstance(payload.get("etag"), str) else ""
            self._last_modified = (
                payload.get("last_modified", "") if isinstance(payload.get("last_modified"), str) else ""
            )
        except (OSError, ValueError, TypeError):
            return

    @staticmethod
    def _validate(value: object) -> tuple[list[int], int]:
        if not isinstance(value, list):
            raise ValueError("Priority AppID payload must be a JSON array")
        appids: list[int] = []
        seen: set[int] = set()
        invalid = 0
        for raw in value:
            appid = raw if isinstance(raw, int) and not isinstance(raw, bool) else None
            if appid is None or appid <= 0:
                invalid += 1
                continue
            if appid in seen:
                continue
            seen.add(appid)
            appids.append(appid)
        if not appids:
            raise ValueError("Priority AppID payload has no valid IDs")
        return appids, invalid

    def _write_cache(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {
                "appids": self._appids,
                "etag": self._etag,
                "last_modified": self._last_modified,
            },
            separators=(",", ":"),
        )
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{self.cache_path.name}.",
            dir=self.cache_path.parent,
            text=True,
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.cache_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    async def get_appids(self) -> list[int]:
        if time.monotonic() - self._last_checked < self.refresh_seconds and self._appids:
            return list(self._appids)
        async with self._lock:
            if time.monotonic() - self._last_checked < self.refresh_seconds and self._appids:
                return list(self._appids)
            self._last_checked = time.monotonic()
            if not self.url:
                if self._appids:
                    return list(self._appids)
                raise PriorityUnavailable("NEXAPLAY_PRIORITY_URL is not configured and no valid cache exists")

            headers: dict[str, str] = {"Accept": "application/json"}
            if self._etag:
                headers["If-None-Match"] = self._etag
            if self._last_modified:
                headers["If-Modified-Since"] = self._last_modified
            try:
                result = await asyncio.to_thread(self.fetcher, self.url, headers, self.timeout_seconds)
                if result.status == 304 and self._appids:
                    return list(self._appids)
                if result.status != 200:
                    raise PriorityUnavailable(f"Priority source returned HTTP {result.status}")
                appids, invalid = self._validate(json.loads(result.body))
                self._appids = appids
                self._etag = result.headers.get("ETag", "")
                self._last_modified = result.headers.get("Last-Modified", "")
                self._write_cache()
                if invalid:
                    LOG.warning("Ignored %s invalid priority AppID entries", invalid)
                return list(self._appids)
            except Exception as error:
                if self._appids:
                    LOG.warning("Priority refresh failed; using last-known-good cache: %s", error)
                    return list(self._appids)
                if isinstance(error, PriorityUnavailable):
                    raise
                raise PriorityUnavailable("Catalog priority is temporarily unavailable") from error
