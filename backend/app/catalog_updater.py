from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import threading
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urljoin, urlsplit

from .database import CatalogDatabase


LOG = logging.getLogger(__name__)
GAME_COLUMNS = (
    "appid",
    "name",
    "normalized_name",
    "library_capsule",
    "genre",
    "price_normalized",
    "price_display",
    "protection",
    "tier",
    "pc_requirements",
)


@dataclass(frozen=True)
class Download:
    body: bytes
    headers: Mapping[str, str]


@dataclass(frozen=True)
class UpdateResult:
    status: str
    initial_version: int
    current_version: int
    applied: int
    message: str
    latest_remote_version: int | None = None


def download_http(url: str, timeout: float) -> Download:
    request = urllib.request.Request(url, headers={"User-Agent": "NexaPlay-Web-Updater/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return Download(response.read(), dict(response.headers.items()))


class ProcessFileLock:
    def __init__(self, path: Path):
        self.path = path
        self.handle = None

    def __enter__(self) -> "ProcessFileLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+b")
        if os.name == "nt":
            import msvcrt

            if self.handle.seek(0, os.SEEK_END) == 0:
                self.handle.write(b"\0")
                self.handle.flush()
            self.handle.seek(0)
            msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return self

    def __exit__(self, *_: object) -> None:
        if not self.handle:
            return
        if os.name == "nt":
            import msvcrt

            self.handle.seek(0)
            msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()


class CatalogUpdater:
    def __init__(
        self,
        database: CatalogDatabase,
        manifest_url: str,
        timeout_seconds: float,
        downloader: Callable[[str, float], Download] = download_http,
    ):
        self.database = database
        self.manifest_url = manifest_url
        self.timeout_seconds = timeout_seconds
        self.downloader = downloader
        self._thread_lock = threading.Lock()
        self._process_lock_path = database.path.with_suffix(database.path.suffix + ".update.lock")

    def check_and_apply(self) -> UpdateResult:
        with self._thread_lock:
            try:
                with ProcessFileLock(self._process_lock_path):
                    return self._check_and_apply_locked()
            except OSError as error:
                version = self.database.catalog_version()
                return UpdateResult("Busy", version, version, 0, str(error))

    def _check_and_apply_locked(self) -> UpdateResult:
        initial = self.database.catalog_version()
        current = initial
        applied = 0
        latest: int | None = None
        try:
            manifest = json.loads(self.downloader(self.manifest_url, self.timeout_seconds).body)
            self._validate_manifest(manifest)
            latest = manifest["latest_version"]
            minimum = manifest["minimum_supported_version"]
            if current == latest:
                return UpdateResult("NoChange", initial, current, 0, "Catalog already current.", latest)
            if current > latest:
                return UpdateResult("LocalAhead", initial, current, 0, "Local catalog is newer than remote.", latest)
            if current < minimum:
                return UpdateResult("UnsupportedBaseline", initial, current, 0, "Catalog baseline is too old.", latest)

            by_version = {entry["version"]: entry for entry in manifest["patches"]}
            chain = []
            for version in range(current + 1, latest + 1):
                if version not in by_version:
                    raise ValueError(f"Catalog patch {version} is missing")
                chain.append(by_version[version])

            for entry in chain:
                patch_url = self._patch_url(entry["file"])
                body = self.downloader(patch_url, self.timeout_seconds).body
                if len(body) != entry["size"]:
                    raise ValueError(f"Patch {entry['version']} size mismatch")
                digest = hashlib.sha256(body).hexdigest()
                if digest.lower() != entry["sha256"].lower():
                    raise ValueError(f"Patch {entry['version']} SHA-256 mismatch")
                patch = self._parse_patch(body)
                if patch["from_version"] != current or patch["to_version"] != entry["version"]:
                    raise ValueError(f"Patch chain mismatch at version {entry['version']}")
                self._apply_patch(patch)
                current = patch["to_version"]
                applied += 1
            return UpdateResult("Applied", initial, current, applied, "Catalog patches applied.", latest)
        except Exception as error:
            try:
                current = self.database.catalog_version()
            except Exception:
                pass
            LOG.exception("Catalog update failed; last committed database retained")
            return UpdateResult("Failed", initial, current, applied, str(error), latest)

    @staticmethod
    def _validate_manifest(manifest: Any) -> None:
        if not isinstance(manifest, dict):
            raise ValueError("Catalog manifest is invalid")
        schema = manifest.get("schema_version")
        latest = manifest.get("latest_version")
        minimum = manifest.get("minimum_supported_version")
        patches = manifest.get("patches")
        if schema != 1 or not CatalogUpdater._is_int(latest) or latest <= 0:
            raise ValueError("Catalog manifest version fields are invalid")
        if not CatalogUpdater._is_int(minimum) or minimum <= 0 or minimum > latest or not isinstance(patches, list):
            raise ValueError("Catalog manifest version fields are invalid")
        seen: set[int] = set()
        for entry in patches:
            if not isinstance(entry, dict):
                raise ValueError("Catalog manifest patch entry is invalid")
            version = entry.get("version")
            size = entry.get("size")
            digest = entry.get("sha256")
            file_name = entry.get("file")
            if (
                not CatalogUpdater._is_int(version)
                or version <= 0
                or version in seen
                or not CatalogUpdater._is_int(size)
                or size < 0
                or not isinstance(digest, str)
                or len(digest) != 64
                or any(character not in "0123456789abcdefABCDEF" for character in digest)
                or not isinstance(file_name, str)
                or not file_name.strip()
            ):
                raise ValueError("Catalog manifest contains invalid or duplicate patch entry")
            seen.add(version)

    def _patch_url(self, file_name: str) -> str:
        if urlsplit(file_name).scheme or file_name.startswith("/") or ".." in file_name:
            raise ValueError(f"Patch path is invalid: {file_name}")
        patch_url = urljoin(self.manifest_url, file_name)
        manifest_origin = urlsplit(self.manifest_url)
        patch_origin = urlsplit(patch_url)
        if (patch_origin.scheme, patch_origin.netloc) != (manifest_origin.scheme, manifest_origin.netloc):
            raise ValueError("Patch URL left catalog origin")
        return patch_url

    @staticmethod
    def _parse_patch(body: bytes) -> dict[str, Any]:
        patch = json.loads(body)
        if not isinstance(patch, dict):
            raise ValueError("Catalog patch is invalid")
        if (
            patch.get("schema_version") != 1
            or not CatalogUpdater._is_int(patch.get("from_version"))
            or patch["from_version"] <= 0
            or patch.get("to_version") != patch["from_version"] + 1
            or not isinstance(patch.get("upsert"), list)
            or not isinstance(patch.get("delete"), list)
        ):
            raise ValueError("Catalog patch version fields are invalid")

        upsert_ids: set[int] = set()
        for row in patch["upsert"]:
            if not isinstance(row, dict) or set(row) != set(GAME_COLUMNS):
                raise ValueError("Catalog patch upsert row fields are invalid")
            appid = row.get("appid")
            if (
                not CatalogUpdater._is_int(appid)
                or appid <= 0
                or appid in upsert_ids
                or not isinstance(row.get("name"), str)
                or not row["name"].strip()
                or not isinstance(row.get("normalized_name"), str)
                or not row["normalized_name"].strip()
                or row.get("library_capsule") is not None
                and not isinstance(row.get("library_capsule"), str)
                or not isinstance(row.get("genre"), list)
                or not CatalogUpdater._is_int(row.get("price_normalized"))
                or row.get("price_display") is not None
                and not isinstance(row.get("price_display"), str)
                or not isinstance(row.get("protection"), bool)
                or row.get("tier") not in {"standard", "premium"}
                or not isinstance(row.get("pc_requirements"), dict)
            ):
                raise ValueError("Catalog patch contains invalid or duplicate upsert row")
            upsert_ids.add(appid)

        delete_ids: set[int] = set()
        for appid in patch["delete"]:
            if (
                not CatalogUpdater._is_int(appid)
                or appid <= 0
                or appid in delete_ids
                or appid in upsert_ids
            ):
                raise ValueError("Catalog patch delete rows are invalid or conflict with upserts")
            delete_ids.add(appid)
        return patch

    @staticmethod
    def _is_int(value: object) -> bool:
        return isinstance(value, int) and not isinstance(value, bool)

    def _apply_patch(self, patch: dict[str, Any]) -> None:
        with self.database.connect(readonly=False) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT value FROM catalog_meta WHERE key = 'catalog_version'"
                ).fetchone()
                current = int(row["value"]) if row else 0
                if patch["from_version"] != current or patch["to_version"] != current + 1:
                    raise ValueError(
                        f"Patch version mismatch. local={current}, from={patch['from_version']}, to={patch['to_version']}"
                    )
                for game in patch["upsert"]:
                    connection.execute(
                        """
                        INSERT INTO games
                            (appid, name, normalized_name, library_capsule, genre, price_normalized,
                             price_display, protection, tier, pc_requirements)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(appid) DO UPDATE SET
                            name = excluded.name,
                            normalized_name = excluded.normalized_name,
                            library_capsule = excluded.library_capsule,
                            genre = excluded.genre,
                            price_normalized = excluded.price_normalized,
                            price_display = excluded.price_display,
                            protection = excluded.protection,
                            tier = excluded.tier,
                            pc_requirements = excluded.pc_requirements
                        """,
                        (
                            game["appid"],
                            game["name"],
                            game["normalized_name"],
                            game["library_capsule"],
                            json.dumps(game["genre"], separators=(",", ":"), ensure_ascii=False),
                            game["price_normalized"],
                            game["price_display"] or "Free",
                            int(game["protection"]),
                            game["tier"],
                            json.dumps(game["pc_requirements"], separators=(",", ":"), ensure_ascii=False),
                        ),
                    )
                connection.executemany(
                    "DELETE FROM games WHERE appid = ?",
                    ((appid,) for appid in patch["delete"]),
                )
                connection.execute(
                    """
                    INSERT INTO catalog_meta(key, value) VALUES('catalog_version', ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    """,
                    (str(patch["to_version"]),),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
