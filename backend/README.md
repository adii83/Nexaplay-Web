# NexaPlay Website Catalog API

FastAPI service exposing bounded reads from VPS-local `catalog.sqlite`. External Catalog Builder/Publisher, R2 manifest, and patch format stay unchanged.

## Production status

- Public API: `https://api.nexaplayid.store`
- Internal listener: `127.0.0.1:8010`
- Deployment root: `/home/nexaplay/nexaplay_web`
- Environment file: `/home/nexaplay/nexaplay_web/backend/.env`
- SQLite: `/home/nexaplay/nexaplay_web/data/catalog.sqlite`

Port `8000` belongs to the existing Telegram service. NexaPlay Web must remain on port `8010`.

## Runtime flow

```text
R2 catalog_manifest.json + patches -> updater -> catalog.sqlite games table -> CatalogRepository -> API
GitHub appid_populer.json -> validated cache -> normal catalog priority
Local appid_trending.json -> SQLite lookup -> Game Terpopuler
SQLite COUNT + display anchor -> /api/stats
GitHub Pages -> https://api.nexaplayid.store -> Nginx -> FastAPI
```

The `games` table owns all Web game metadata. `CatalogRepository` reads `appid`, `name`, `normalized_name`, `library_capsule`, `genre`, `tier`, and `pc_requirements` directly from `games`. Remote `appid_populer.json` supplies only normal catalog priority order. Local `appid_trending.json` supplies only Game Terpopuler order. Browser never downloads SQLite, static search index, overrides, raw GitHub data, or R2 per-game metadata.

SQLite snapshots may contain the Desktop/legacy `catalog_runtime_overrides` table. The Web API does not join or merge that table, so it cannot override current `games` values. Keep the table intact when present; no destructive migration or row cleanup is required.

## API

- `GET /api/health` returns `status`, `catalog_version`, and compact updater state.
- `GET /api/games?q=&tier=&page=1&limit=20` returns `appid`, `name`, `library_capsule`, `tier`. Empty-query browse requires a usable HTTP(S) poster and applies remote priority before pagination. Search keeps posterless matches.
- `GET /api/games?ids=10,570` preserves requested order, removes duplicates, skips missing rows, max 100 IDs.
- `GET /api/games/trending` resolves ordered local editorial AppIDs against SQLite and keeps posterless games.
- `GET /api/games/{appid}` returns `appid`, `name`, `library_capsule`, `genre`, `tier`, `pc_requirements`.
- `GET /api/stats` returns real SQLite `actual_count` and presentation-only `display_count`.

Public responses never include price, protection, publisher, developer, filesystem paths, or raw metadata JSON.

Numeric `q` performs exact positive AppID lookup. Other `q` values use Desktop-compatible Unicode normalization and SQLite `normalized_name` substring matching. `tier` accepts only `premium` or `standard`. Page size is 1-60.

## Configuration

Production configuration is maintained locally in `backend/.env.production`. It is gitignored and contains target VPS paths, not Windows paths. Upload it without editing values on the server:

```bash
sudo install -m 0640 -o root -g www-data \
  /path/to/uploaded/.env.production \
  /home/nexaplay/nexaplay_web/backend/.env
```

Both systemd services read `/home/nexaplay/nexaplay_web/backend/.env`. `.env.example` remains the safe committed reference; `.env.production` is the canonical local production file.

Production paths point to the deployed root and writable data directory:

```bash
NEXAPLAY_TRENDING_PATH=/home/nexaplay/nexaplay_web/appid_trending.json
NEXAPLAY_DISPLAY_STATS_PATH=/home/nexaplay/nexaplay_web/data/display_stats.json
```

Remote priority URL is `https://raw.githubusercontent.com/adii83/Nexaplay-Metadata-Override/main/appid_populer.json`. Cache behavior: five-minute refresh, conditional `ETag`/`Last-Modified`, same-process request deduplication, duplicate/invalid filtering, atomic replacement, and last-known-good fallback. If remote priority and cache are unavailable, normal catalog browsing continues in SQLite name order.

`display_stats.json` stores only `base_count` and UTC `anchor_time`. API computes elapsed whole hours on request. No scheduler, hourly DB write, or hourly JSON write exists. State is atomically created or rebased only when real SQLite count overtakes projected display count.

## Bootstrap and deploy

```bash
sudo useradd --system --home /home/nexaplay --create-home nexaplay
sudo install -d -o nexaplay -g www-data /home/nexaplay/nexaplay_web/data
sudo install -m 0640 -o nexaplay -g www-data /path/to/catalog_seed.sqlite /home/nexaplay/nexaplay_web/data/catalog.sqlite
cd /home/nexaplay/nexaplay_web/backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
sudo install -m 0640 -o root -g www-data /path/to/uploaded/.env.production .env
```

Edit environment file, then install units:

```bash
sudo install -m 0644 systemd/nexaplay-api.service /etc/systemd/system/
sudo install -m 0644 systemd/nexaplay-catalog-update.service /etc/systemd/system/
sudo install -m 0644 systemd/nexaplay-catalog-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nexaplay-api.service nexaplay-catalog-update.timer
```

Service runs one safe update attempt before API start. Failure does not block API startup. Timer retries every five minutes. Keep `NEXAPLAY_BACKGROUND_UPDATES=0` when timer is enabled. Process lock prevents overlapping updater runs.

Uvicorn listens only on `127.0.0.1:8010`. Nginx owns public HTTP/HTTPS access and proxies `api.nexaplayid.store` to that listener.

Install `nginx/api.nexaplayid.store.conf` as a separate site. Do not edit Telegram/Discord server blocks. Obtain TLS certificate, enable site, run `sudo nginx -t`, then reload Nginx.

See `DEPLOY_FILES.md` for exact local-to-VPS file mappings. Initial `catalog.sqlite` is uploaded separately and never committed to this repository.

## Updater protocol

Updater reads current `catalog_version`, validates schema/version bounds, builds complete sequential chain, restricts patch paths to manifest origin, verifies byte size and SHA-256, validates unique positive AppIDs and conflicts, then applies one patch per SQLite transaction. Every game column is upserted into `games`, including `price_normalized`, `price_display`, and `protection`. Failed patch rolls back; earlier committed patches remain valid. Unsupported baselines require controlled seed replacement.

Manual update and status:

```bash
cd /home/nexaplay/nexaplay_web/backend
set -a
source .env
set +a
./.venv/bin/python -m app.update_catalog
systemctl status nexaplay-api.service nexaplay-catalog-update.timer
journalctl -u nexaplay-api.service -u nexaplay-catalog-update.service --since today
curl -fsS https://api.nexaplayid.store/api/health
curl -fsS https://api.nexaplayid.store/api/stats
curl -fsS https://api.nexaplayid.store/api/games/trending
```

## Tests

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v
```

Live integration copies source databases into temporary directories before updater tests:

```bash
NEXAPLAY_LIVE_INTEGRATION=1 \
NEXAPLAY_ACTUAL_CATALOG_DB=/path/to/current/catalog.sqlite \
NEXAPLAY_SEED_CATALOG_DB=/path/to/catalog_seed.sqlite \
.venv/bin/python -m unittest tests.test_actual_catalog -v
```

## Rollback

1. Stop API and timer: `sudo systemctl stop nexaplay-api.service nexaplay-catalog-update.timer`.
2. Move failed VPS DB aside; restore last backup or known compatible seed as `data/catalog.sqlite`.
3. Load `.env` and run `./.venv/bin/python -m app.update_catalog`; verify health locally on `127.0.0.1:8010`.
4. Restart API. If API cutover itself must be reverted, restore the prior GitHub Pages commit and restore the last known-good VPS SQLite backup.
