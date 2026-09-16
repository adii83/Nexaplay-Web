from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


REQUIRED_GAME_COLUMNS = {
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
}


class CatalogDatabase:
    def __init__(self, path: Path):
        self.path = path.resolve()

    @contextmanager
    def connect(self, *, readonly: bool = True) -> Iterator[sqlite3.Connection]:
        if readonly:
            connection = sqlite3.connect(
                f"file:{self.path.as_posix()}?mode=ro",
                uri=True,
                timeout=5,
            )
        else:
            connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        try:
            yield connection
        finally:
            connection.close()

    def validate(self) -> None:
        if not self.path.is_file():
            raise FileNotFoundError(f"Catalog database not found: {self.path}")
        with self.connect() as connection:
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(games)").fetchall()
            }
            if not REQUIRED_GAME_COLUMNS.issubset(columns):
                missing = ", ".join(sorted(REQUIRED_GAME_COLUMNS - columns))
                raise RuntimeError(f"Catalog database missing columns: {missing}")

    def catalog_version(self) -> int:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT value FROM catalog_meta WHERE key = 'catalog_version'"
            ).fetchone()
        try:
            return int(row["value"]) if row else 0
        except (TypeError, ValueError):
            return 0
