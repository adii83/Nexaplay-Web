#!/usr/bin/env python3
"""
Build an enriched NexaPlay web catalog from games_list.json.

Final output fields per item:
  - appid
  - title
  - premium
  - cover_url
  - publishers
  - genres
  - specification.minimum
  - specification.recommended

Cover fallback order:
1. nexaplay_override.json catalog override
2. local metadata assets.library_capsule
3. local metadata assets.library_capsule_2x
4. local metadata assets.header
5. "NO CONTENT"
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterator, Optional, Tuple


NEXAPLAY_OVERRIDE_URL = (
    "https://raw.githubusercontent.com/adii83/Nexaplay-Metadata-Override/refs/heads/main/nexaplay_override.json"
)
DEFAULT_LOCAL_METADATA_DIR = Path(r"D:\My Project\___Metadata Nexaplay Cloudfare R2\Metadata")
DEFAULT_GAMES_LIST_PATH = Path(__file__).resolve().parent / "games_list.json"
DEFAULT_TIMEOUT = 25
DEFAULT_WORKERS = 12
DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHECKPOINT_EVERY = 250
NO_CONTENT = "NO CONTENT"


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def load_json_file(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json_file(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_path.replace(path)


def download_file(url: str, destination: Path, timeout: int) -> Path:
    ensure_dir(destination.parent)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "NexaPlay-Web-Catalog-Builder/2.0",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        destination.write_bytes(response.read())
    return destination


def maybe_download(url: str, destination: Path, timeout: int, force: bool) -> Path:
    if destination.exists() and not force:
        return destination
    eprint(f"Downloading: {url}")
    return download_file(url, destination, timeout)


def coerce_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return int(float(stripped))
        except ValueError:
            return None
    return None


def coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "premium"}
    return False


def sanitize_filename(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in value)


def extract_first_url(items: Any) -> Optional[str]:
    if not isinstance(items, list):
        return None
    for item in items:
        if isinstance(item, dict):
            url = item.get("url")
            if isinstance(url, str) and url.strip():
                return url.strip()
    return None


def resolve_cover_from_override(override_entry: Any) -> Optional[str]:
    if not isinstance(override_entry, dict):
        return None
    catalog = override_entry.get("catalog")
    if not isinstance(catalog, dict):
        return None
    for key in ("library_capsule", "library_capsule_2x", "header"):
        value = catalog.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def load_local_metadata(metadata_dir: Path, appid: int) -> Optional[Dict[str, Any]]:
    path = metadata_dir / f"{appid}.json"
    if not path.exists():
        return None
    try:
        payload = load_json_file(path)
    except Exception as exc:
        eprint(f"Failed to read local metadata for appid {appid}: {exc}")
        return None
    return payload if isinstance(payload, dict) else None


def resolve_cover_from_metadata(metadata: Dict[str, Any]) -> str:
    assets = metadata.get("assets")
    if isinstance(assets, dict):
        for key in ("library_capsule", "library_capsule_2x", "header"):
            url = extract_first_url(assets.get(key))
            if url:
                return url
    return NO_CONTENT


def extract_publishers(metadata: Dict[str, Any]) -> list[str]:
    source = metadata.get("store_data") if isinstance(metadata.get("store_data"), dict) else metadata
    publishers = source.get("publishers") if isinstance(source, dict) else None
    if not isinstance(publishers, list):
        return []
    return [value.strip() for value in publishers if isinstance(value, str) and value.strip()]


def extract_genres(metadata: Dict[str, Any]) -> list[str]:
    source = metadata.get("store_data") if isinstance(metadata.get("store_data"), dict) else metadata
    genres = source.get("genres") if isinstance(source, dict) else None
    if not isinstance(genres, list):
        return []

    resolved: list[str] = []
    for genre in genres:
        if isinstance(genre, str) and genre.strip():
            resolved.append(genre.strip())
        elif isinstance(genre, dict):
            description = genre.get("description")
            if isinstance(description, str) and description.strip():
                resolved.append(description.strip())
    return resolved


def normalize_spec_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def extract_specification(metadata: Dict[str, Any]) -> Dict[str, str]:
    source = metadata.get("store_data") if isinstance(metadata.get("store_data"), dict) else metadata
    pc_requirements = source.get("pc_requirements") if isinstance(source, dict) else None
    if isinstance(pc_requirements, dict):
        minimum = normalize_spec_text(pc_requirements.get("minimum"))
        recommended = normalize_spec_text(pc_requirements.get("recommended"))
        return {
            "minimum": minimum,
            "recommended": recommended,
        }

    requirements = source.get("requirements") if isinstance(source, dict) else None
    if isinstance(requirements, dict):
        minimum = normalize_spec_text(requirements.get("minimum"))
        recommended = normalize_spec_text(requirements.get("recommended"))
        return {
            "minimum": minimum,
            "recommended": recommended,
        }

    return {
        "minimum": "",
        "recommended": "",
    }


def build_base_catalog(games_list_path: Path, limit: Optional[int]) -> Dict[int, Dict[str, Any]]:
    payload = load_json_file(games_list_path)
    if not isinstance(payload, list):
        raise ValueError("games_list.json root must be a JSON array")

    catalog: Dict[int, Dict[str, Any]] = {}
    count = 0
    for item in payload:
        if not isinstance(item, dict):
            continue
        appid = coerce_int(item.get("appid"))
        title = item.get("title")
        if appid is None or not isinstance(title, str) or not title.strip():
            continue

        catalog[appid] = {
            "appid": appid,
            "title": title.strip(),
            "premium": coerce_bool(item.get("premium")),
        }
        count += 1
        if limit is not None and count >= limit:
            break

    return catalog


def enrich_catalog_item(
    appid: int,
    base_item: Dict[str, Any],
    metadata_dir: Path,
    nexaplay_override_map: Dict[str, Any],
) -> Dict[str, Any]:
    metadata = load_local_metadata(metadata_dir, appid) or {}

    override_cover = resolve_cover_from_override(nexaplay_override_map.get(str(appid)))
    cover_url = override_cover or resolve_cover_from_metadata(metadata)

    return {
        "appid": appid,
        "title": base_item["title"],
        "premium": base_item["premium"],
        "cover_url": cover_url,
        "publishers": extract_publishers(metadata),
        "genres": extract_genres(metadata),
        "specification": extract_specification(metadata),
    }


def chunked(items: list[Dict[str, Any]], chunk_size: int) -> Iterator[list[Dict[str, Any]]]:
    for index in range(0, len(items), chunk_size):
        yield items[index : index + chunk_size]


def load_resume_state(path: Path) -> Tuple[set[int], Dict[int, Dict[str, Any]]]:
    if not path.exists():
        return set(), {}

    payload = load_json_file(path)
    if not isinstance(payload, dict):
        return set(), {}

    processed_raw = payload.get("processed_appids", [])
    items_raw = payload.get("items", [])
    processed: set[int] = set()
    items_by_appid: Dict[int, Dict[str, Any]] = {}

    if isinstance(processed_raw, list):
        for value in processed_raw:
            appid = coerce_int(value)
            if appid is not None:
                processed.add(appid)

    if isinstance(items_raw, list):
        for item in items_raw:
            if not isinstance(item, dict):
                continue
            appid = coerce_int(item.get("appid"))
            title = item.get("title")
            premium = item.get("premium")
            cover_url = item.get("cover_url")
            publishers = item.get("publishers")
            genres = item.get("genres")
            specification = item.get("specification")

            if (
                appid is None
                or not isinstance(title, str)
                or not isinstance(premium, bool)
                or not isinstance(cover_url, str)
                or not isinstance(publishers, list)
                or not isinstance(genres, list)
                or not isinstance(specification, dict)
            ):
                continue

            items_by_appid[appid] = item

    return processed, items_by_appid


def resume_item_is_complete(item: Dict[str, Any]) -> bool:
    publishers = item.get("publishers")
    genres = item.get("genres")
    specification = item.get("specification")
    return (
        isinstance(publishers, list)
        and isinstance(genres, list)
        and isinstance(specification, dict)
        and "minimum" in specification
        and "recommended" in specification
    )


def save_resume_state(
    path: Path,
    processed_appids: set[int],
    items_by_appid: Dict[int, Dict[str, Any]],
    total_candidates: int,
) -> None:
    payload = {
        "total_candidates": total_candidates,
        "processed_count": len(processed_appids),
        "kept_count": len(items_by_appid),
        "processed_appids": sorted(processed_appids),
        "items": sorted(items_by_appid.values(), key=lambda item: item["appid"]),
        "updated_at_epoch": int(time.time()),
    }
    write_json_file(path, payload)


def write_outputs(
    items: list[Dict[str, Any]],
    output_dir: Path,
    chunk_size: int,
    write_chunks: bool,
) -> None:
    ensure_dir(output_dir)
    write_json_file(output_dir / "catalog.json", items)

    if not write_chunks:
        return

    chunks_dir = output_dir / "chunks"
    ensure_dir(chunks_dir)
    for index, chunk_items in enumerate(chunked(items, chunk_size), start=1):
        write_json_file(chunks_dir / f"catalog-{index:04d}.json", chunk_items)


def remove_old_chunks(output_dir: Path) -> None:
    chunks_dir = output_dir / "chunks"
    if not chunks_dir.exists():
        return
    for path in chunks_dir.glob("catalog-*.json"):
        path.unlink(missing_ok=True)


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build an enriched NexaPlay web catalog from games_list.json."
    )
    parser.add_argument(
        "--workspace",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Base folder for caches and output. Defaults to the script folder.",
    )
    parser.add_argument(
        "--games-list",
        type=Path,
        default=DEFAULT_GAMES_LIST_PATH,
        help="Base games_list.json path.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory. Defaults to <workspace>/output.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="Cache directory. Defaults to <workspace>/cache.",
    )
    parser.add_argument(
        "--metadata-dir",
        type=Path,
        default=DEFAULT_LOCAL_METADATA_DIR,
        help="Local metadata folder.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"Concurrent workers. Default: {DEFAULT_WORKERS}",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"Download timeout in seconds. Default: {DEFAULT_TIMEOUT}",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=DEFAULT_CHUNK_SIZE,
        help=f"Items per chunk file. Default: {DEFAULT_CHUNK_SIZE}",
    )
    parser.add_argument(
        "--no-chunks",
        action="store_true",
        help="Only write catalog.json and skip chunk files.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only the first N base items. Useful for testing.",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Re-download nexaplay_override.json.",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=DEFAULT_CHECKPOINT_EVERY,
        help=f"Save resume progress every N processed appids. Default: {DEFAULT_CHECKPOINT_EVERY}",
    )
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help="Ignore existing resume progress and rebuild from scratch.",
    )
    return parser


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    workspace = args.workspace.resolve()
    games_list_path = args.games_list.resolve()
    output_dir = (args.output_dir or workspace / "output").resolve()
    cache_dir = (args.cache_dir or workspace / "cache").resolve()
    metadata_dir = args.metadata_dir.resolve()
    resume_state_path = output_dir / "resume_state.json"

    ensure_dir(workspace)
    ensure_dir(output_dir)
    ensure_dir(cache_dir)

    if not games_list_path.exists():
        raise FileNotFoundError(f"games_list.json not found: {games_list_path}")
    if not metadata_dir.exists():
        raise FileNotFoundError(f"metadata folder not found: {metadata_dir}")

    nexaplay_override_path = maybe_download(
        NEXAPLAY_OVERRIDE_URL,
        cache_dir / "nexaplay_override.json",
        timeout=args.timeout,
        force=args.force_download,
    )

    eprint("Loading games_list.json ...")
    base_catalog = build_base_catalog(games_list_path, args.limit)
    eprint(f"Base items ready: {len(base_catalog)}")

    eprint("Loading nexaplay_override.json ...")
    nexaplay_override_map = load_json_file(nexaplay_override_path)
    if not isinstance(nexaplay_override_map, dict):
        raise ValueError("nexaplay_override.json root is not a JSON object")

    processed_appids: set[int] = set()
    items_by_appid: Dict[int, Dict[str, Any]] = {}
    if not args.no_resume and not args.force_download:
        processed_appids, items_by_appid = load_resume_state(resume_state_path)
        invalid_appids = {
            appid for appid, item in items_by_appid.items() if not resume_item_is_complete(item)
        }
        if invalid_appids:
            for appid in invalid_appids:
                items_by_appid.pop(appid, None)
                processed_appids.discard(appid)
        if processed_appids:
            eprint(
                f"Resume state found: {len(processed_appids)} processed, {len(items_by_appid)} kept"
            )

    appids = sorted(base_catalog.keys())
    appids_to_process = [appid for appid in appids if appid not in processed_appids]
    processed = len(processed_appids)
    checkpoint_every = max(1, args.checkpoint_every)
    started = time.time()

    eprint("Resolving cover_url, publishers, genres, and specification from local metadata ...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        future_map = {
            pool.submit(
                enrich_catalog_item,
                appid,
                base_catalog[appid],
                metadata_dir,
                nexaplay_override_map,
            ): appid
            for appid in appids_to_process
        }

        for future in concurrent.futures.as_completed(future_map):
            appid = future_map[future]
            processed += 1
            processed_appids.add(appid)

            try:
                items_by_appid[appid] = future.result()
            except Exception as exc:
                eprint(f"Unexpected error for appid {appid}: {exc}")

            if processed % checkpoint_every == 0:
                save_resume_state(
                    resume_state_path,
                    processed_appids,
                    items_by_appid,
                    total_candidates=len(appids),
                )

            if processed % 250 == 0 or processed == len(appids):
                eprint(
                    f"Progress: {processed}/{len(appids)} processed, {len(items_by_appid)} kept"
                )

    results = sorted(items_by_appid.values(), key=lambda item: item["appid"])
    remove_old_chunks(output_dir)
    write_outputs(
        items=results,
        output_dir=output_dir,
        chunk_size=max(1, args.chunk_size),
        write_chunks=not args.no_chunks,
    )
    resume_state_path.unlink(missing_ok=True)

    duration = time.time() - started
    eprint(f"Done. Wrote {len(results)} items to {output_dir} in {duration:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
