from __future__ import annotations

import json
import sqlite3
from pathlib import Path


def create_catalog(path: Path, version: int = 2) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        f"""
        CREATE TABLE catalog_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO catalog_meta VALUES('schema_version', '1'), ('catalog_version', '{version}');
        CREATE TABLE games(
            appid INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            library_capsule TEXT NULL,
            genre TEXT NOT NULL,
            price_normalized INTEGER NOT NULL DEFAULT 0,
            price_display TEXT NOT NULL DEFAULT 'Free',
            protection INTEGER NOT NULL DEFAULT 0 CHECK(protection IN (0,1)),
            tier TEXT NOT NULL CHECK(tier IN ('standard','premium')),
            pc_requirements TEXT NOT NULL
        );
        CREATE TABLE catalog_runtime_overrides(
            appid INTEGER PRIMARY KEY,
            name TEXT NULL,
            normalized_name TEXT NULL,
            library_capsule TEXT NULL,
            genre TEXT NULL,
            price_normalized INTEGER NULL,
            price_display TEXT NULL,
            protection INTEGER NULL,
            tier TEXT NULL
        );
        """
    )
    rows = [
        (10, "Counter-Strike", "counter strike", "https://example.test/10.jpg", ["Action"], 0, "Free", 0, "standard", {"minimum": "Windows", "recommended": "Windows 11"}),
        (20, "Cafe Racer", "cafe racer", "", "malformed", 200000, "Rp 200.000", 1, "premium", "malformed"),
        (30, "Zeta Game", "zeta game", None, ["RPG"], 100000, "Rp 100.000", 0, "standard", {"minimum": "", "recommended": ""}),
    ]
    for row in rows:
        genre = json.dumps(row[4]) if isinstance(row[4], list) else row[4]
        requirements = json.dumps(row[9]) if isinstance(row[9], dict) else row[9]
        connection.execute(
            "INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?,?)",
            (*row[:4], genre, *row[5:9], requirements),
        )
    connection.commit()
    connection.close()


def patch_row(appid: int, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "appid": appid,
        "name": f"Game {appid}",
        "normalized_name": f"game {appid}",
        "library_capsule": f"https://example.test/{appid}.jpg",
        "genre": ["Action"],
        "price_normalized": 345678,
        "price_display": "Rp 345.678",
        "protection": True,
        "tier": "premium",
        "pc_requirements": {"minimum": "min", "recommended": "rec"},
    }
    row.update(overrides)
    return row
