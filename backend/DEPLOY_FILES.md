# VPS Deployment Files

Canonical VPS root: `/home/nexaplay/nexaplay_web`

## A. Backend source to upload

| Local | VPS |
| --- | --- |
| `backend/app/` | `/home/nexaplay/nexaplay_web/backend/app/` |
| `backend/requirements.txt` | `/home/nexaplay/nexaplay_web/backend/requirements.txt` |
| `appid_trending.json` | `/home/nexaplay/nexaplay_web/appid_trending.json` |

Tests and `requirements-dev.txt` may be uploaded for VPS verification, but are not required by runtime.

## B. Environment to upload

| Local | VPS |
| --- | --- |
| `backend/.env.production` | `/home/nexaplay/nexaplay_web/backend/.env` |

Both systemd services read that exact VPS path. Keep mode `0640`, owner `root`, group `www-data`.

## C. SQLite to upload separately

| Local source | VPS |
| --- | --- |
| Current external `catalog.sqlite` seed | `/home/nexaplay/nexaplay_web/data/catalog.sqlite` |

Database is not stored in this repository. Upload it separately and set owner `nexaplay:www-data`.

## D. Systemd configuration

| Local | VPS |
| --- | --- |
| `backend/systemd/nexaplay-api.service` | `/etc/systemd/system/nexaplay-api.service` |
| `backend/systemd/nexaplay-catalog-update.service` | `/etc/systemd/system/nexaplay-catalog-update.service` |
| `backend/systemd/nexaplay-catalog-update.timer` | `/etc/systemd/system/nexaplay-catalog-update.timer` |

## E. Nginx configuration

| Local | VPS |
| --- | --- |
| `backend/nginx/api.nexaplayid.store.conf` | `/etc/nginx/sites-available/api.nexaplayid.store` |

Enable through `/etc/nginx/sites-enabled/`, then validate with `nginx -t` before reload.

## F. Files staying on GitHub Pages

- `index.html`
- `showcase.html`
- `CNAME`
- `appid_trending.json`
- `assets/`
- `css/`
- `js/`

Do not publish `backend/.env.production`, `backend/.env`, runtime JSON state, SQLite files, systemd units, or Nginx configuration as public site assets.
