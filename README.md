# NexaPlay Web

NexaPlay Web adalah frontend katalog game statis di GitHub Pages dengan backend FastAPI dan SQLite pada VPS.

## Production

- Website: `https://nexaplayid.store`
- API: `https://api.nexaplayid.store`
- Health: `https://api.nexaplayid.store/api/health`
- VPS root: `/home/nexaplay/nexaplay_web`
- API internal: `127.0.0.1:8010`

Port `8000` digunakan service Telegram lama. NexaPlay Web wajib tetap pada port `8010`.

## Arsitektur

```text
GitHub Pages frontend
        |
        v
api.nexaplayid.store -> Nginx -> FastAPI:8010 -> catalog.sqlite
                                              ^
                                              |
                       R2 catalog_manifest.json + patches
```

- Tabel `games` di SQLite adalah source of truth dan authority final metadata Web.
- Patch katalog diterapkan ke `games`; API Web membaca nilai terbaru langsung dari tabel tersebut.
- `catalog_runtime_overrides` adalah layer Desktop/legacy. Tabelnya boleh tetap ada pada snapshot SQLite, tetapi API Web mengabaikannya.
- Remote `appid_populer.json` menentukan prioritas katalog.
- Local `appid_trending.json` menentukan Game Terpopuler.
- Timer systemd memperbarui SQLite dari manifest dan patch R2 sekitar setiap lima menit.

## Struktur Penting

```text
index.html, showcase.html   Frontend pages
assets/, css/, js/          Frontend assets
appid_trending.json         Ordered trending AppIDs
backend/app/                FastAPI dan updater
backend/systemd/            API service dan update timer
backend/nginx/              Nginx virtual host
backend/.env.production     Local production config, gitignored
backend/DEPLOY_FILES.md     Pemetaan file lokal ke VPS
```

## Pemeriksaan Backend

```bash
systemctl status nexaplay-api.service --no-pager
systemctl status nexaplay-catalog-update.timer --no-pager
curl -sS http://127.0.0.1:8010/api/health
curl -sS https://api.nexaplayid.store/api/health
```

Restart API:

```bash
sudo systemctl restart nexaplay-api.service
```

## Update Katalog

Catalog Builder/Publisher eksternal menghasilkan `catalog_manifest.json` dan patch di Cloudflare R2. Manifest production berada di `https://meta.nexaplaymetadata.online/catalog/catalog_manifest.json`. Timer VPS mengambil patch dan menerapkannya ke `/home/nexaplay/nexaplay_web/data/catalog.sqlite`.

Jika hanya manifest/patch berubah, backend tidak perlu dideploy atau direstart.

Manual updater:

```bash
cd /home/nexaplay/nexaplay_web/backend
set -a
source .env
set +a
./.venv/bin/python -m app.update_catalog
```

## Dokumentasi

- [Tutorial.md](Tutorial.md): setup, deployment, maintenance, rollback, dan troubleshooting lengkap
- [backend/README.md](backend/README.md): kontrak API dan detail backend
- [backend/DEPLOY_FILES.md](backend/DEPLOY_FILES.md): file yang diupload dan destination VPS
- [WEBSITE_DATA_FLOW_AUDIT.md](WEBSITE_DATA_FLOW_AUDIT.md): sejarah audit migrasi dan arsitektur final

Sistem `web_catalog_builder/`, browser runtime `catalog.json`, `chunks/`, legacy `search_index.json`, workflow sync web lama, dan browser direct-fetch metadata R2 sudah deprecated dan dihapus.
