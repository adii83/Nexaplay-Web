# Tutorial Operasional NexaPlay Web

Panduan ini adalah runbook production NexaPlay Web saat ini. Gunakan untuk setup awal, deployment, update katalog, pemeriksaan kesehatan, maintenance, dan troubleshooting.

Dokumentasi utama singkat tersedia di [README.md](README.md). Detail khusus backend tersedia di [backend/README.md](backend/README.md).

## 1. Arsitektur Production

```text
Catalog Builder / Publisher eksternal
        |
        v
Cloudflare R2 catalog_manifest.json + patches
        |
        v
VPS catalog.sqlite
        |
        v
FastAPI + Uvicorn pada 127.0.0.1:8010
        |
        v
Nginx: api.nexaplayid.store
        |
        v
GitHub Pages: nexaplayid.store
```

Komponen penting:

- Frontend adalah HTML/CSS/JavaScript statis di GitHub Pages.
- Backend adalah FastAPI yang membaca SQLite production.
- Nginx meneruskan `api.nexaplayid.store` ke `127.0.0.1:8010`.
- Port `8000` milik service Telegram lama. Jangan gunakan port itu untuk NexaPlay Web.
- Metadata game berasal dari SQLite, bukan dari JSON katalog di browser.
- `appid_trending.json` menentukan urutan Game Terpopuler.
- Remote `appid_populer.json` hanya menentukan prioritas urutan katalog normal.
- Updater menerapkan patch R2 ke SQLite tanpa mengubah format publisher lama.

## 2. URL Production

| Fungsi | URL |
| --- | --- |
| Website | `https://nexaplayid.store` |
| API | `https://api.nexaplayid.store` |
| Health | `https://api.nexaplayid.store/api/health` |
| Manifest katalog | `https://meta.nexaplaymetadata.online/catalog/catalog_manifest.json` |
| Priority AppID | `https://raw.githubusercontent.com/adii83/Nexaplay-Metadata-Override/main/appid_populer.json` |

Endpoint API:

- `GET /api/health`
- `GET /api/games`
- `GET /api/games/trending`
- `GET /api/games/{appid}`
- `GET /api/stats`

## 3. Struktur Lokal dan VPS

Struktur source lokal penting:

```text
<project-root>/
├── index.html
├── showcase.html
├── appid_trending.json
├── assets/
├── css/
├── js/
└── backend/
    ├── app/
    ├── tests/
    ├── nginx/
    ├── systemd/
    ├── .env.example
    ├── .env.production
    ├── DEPLOY_FILES.md
    └── requirements.txt
```

Struktur VPS:

```text
/home/nexaplay/nexaplay_web/
├── appid_trending.json
├── backend/
│   ├── app/
│   ├── .venv/
│   ├── .env
│   ├── nginx/
│   ├── systemd/
│   └── requirements.txt
└── data/
    ├── catalog.sqlite
    ├── priority_appids.json
    └── display_stats.json
```

Path production kanonis:

- Backend: `/home/nexaplay/nexaplay_web/backend`
- Environment: `/home/nexaplay/nexaplay_web/backend/.env`
- SQLite: `/home/nexaplay/nexaplay_web/data/catalog.sqlite`
- Trending: `/home/nexaplay/nexaplay_web/appid_trending.json`

## 4. Environment Production

File lokal:

```text
backend/.env.production
```

Upload sebagai:

```text
/home/nexaplay/nexaplay_web/backend/.env
```

Jangan mengedit nilai production manual dengan `nano` bila file lokal sudah menjadi sumber konfigurasi. Upload ulang file, atur permission, lalu restart service.

```bash
sudo install -m 0640 -o root -g www-data \
  /path/to/uploaded/.env.production \
  /home/nexaplay/nexaplay_web/backend/.env
```

Environment aktif:

- `NEXAPLAY_CATALOG_DB`
- `NEXAPLAY_MANIFEST_URL`
- `NEXAPLAY_PRIORITY_URL`
- `NEXAPLAY_PRIORITY_CACHE`
- `NEXAPLAY_PRIORITY_REFRESH_SECONDS`
- `NEXAPLAY_TRENDING_PATH`
- `NEXAPLAY_DISPLAY_STATS_PATH`
- `NEXAPLAY_UPDATE_INTERVAL_SECONDS`
- `NEXAPLAY_BACKGROUND_UPDATES`
- `NEXAPLAY_NETWORK_TIMEOUT_SECONDS`
- `NEXAPLAY_ALLOWED_ORIGINS`
- `NEXAPLAY_ENV`

`backend/.env.production` dan `backend/.env` harus tetap local/ignored. Jangan menaruh token, password, private key, credential Hostinger, atau secret R2 di dokumentasi atau Git.

## 5. Setup VPS Pertama

### 5.1 Buat user dan direktori

```bash
sudo useradd --system --home /home/nexaplay --create-home nexaplay
sudo install -d -o nexaplay -g www-data /home/nexaplay/nexaplay_web/backend
sudo install -d -o nexaplay -g www-data /home/nexaplay/nexaplay_web/data
```

Jika user sudah ada, jangan dibuat ulang.

### 5.2 Upload source backend

Ikuti pemetaan di [backend/DEPLOY_FILES.md](backend/DEPLOY_FILES.md). Minimal upload:

- `backend/app/`
- `backend/requirements.txt`
- `appid_trending.json`
- `backend/.env.production` sebagai `backend/.env`

### 5.3 Upload SQLite awal

SQLite tidak disimpan di repository web. Upload seed/current database secara terpisah:

```bash
sudo install -m 0640 -o nexaplay -g www-data \
  /path/to/catalog.sqlite \
  /home/nexaplay/nexaplay_web/data/catalog.sqlite
```

### 5.4 Buat virtual environment

```bash
cd /home/nexaplay/nexaplay_web/backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

### 5.5 Install systemd

```bash
sudo install -m 0644 systemd/nexaplay-api.service /etc/systemd/system/
sudo install -m 0644 systemd/nexaplay-catalog-update.service /etc/systemd/system/
sudo install -m 0644 systemd/nexaplay-catalog-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nexaplay-api.service nexaplay-catalog-update.timer
```

API wajib listen hanya pada `127.0.0.1:8010`.

### 5.6 Install Nginx

```bash
sudo install -m 0644 \
  nginx/api.nexaplayid.store.conf \
  /etc/nginx/sites-available/api.nexaplayid.store

sudo ln -s \
  /etc/nginx/sites-available/api.nexaplayid.store \
  /etc/nginx/sites-enabled/api.nexaplayid.store

sudo nginx -t
sudo systemctl reload nginx
```

Nginx untuk API harus memakai:

```text
api.nexaplayid.store -> http://127.0.0.1:8010
```

Jangan mengubah proxy Telegram:

```text
tele.nexaplayid.store -> service lama pada port 8000
```

## 6. DNS dan HTTPS

DNS dikelola melalui Hostinger:

```text
A api  -> IP VPS production
A tele -> IP VPS production
```

Kedua subdomain boleh memakai IP sama karena Nginx memilih virtual host berdasarkan `server_name`.

HTTPS memakai Certbot dan Let's Encrypt. Certificate API:

```text
/etc/letsencrypt/live/api.nexaplayid.store/fullchain.pem
/etc/letsencrypt/live/api.nexaplayid.store/privkey.pem
```

Pemeriksaan:

```bash
sudo nginx -t
systemctl list-timers --all | grep -i certbot
sudo certbot renew --dry-run
sudo systemctl reload nginx
```

## 7. Health Check Setelah Deployment

### Dari VPS langsung

```bash
curl -sS http://127.0.0.1:8010/api/health
```

### Melalui HTTPS

```bash
curl -i https://api.nexaplayid.store/api/health
curl -sS https://api.nexaplayid.store/api/stats
curl -sS https://api.nexaplayid.store/api/games/trending
```

Health response berbentuk:

```json
{
  "status": "ok",
  "catalog_version": 4,
  "latest_remote_version": 4,
  "last_update_status": "NoChange"
}
```

Nilai versi dapat berubah mengikuti katalog.

### CORS

Origin production yang diizinkan:

- `https://nexaplayid.store`
- `https://www.nexaplayid.store`

Pemeriksaan dari Windows:

```powershell
curl.exe -i -H "Origin: https://nexaplayid.store" "https://api.nexaplayid.store/api/health"
```

Expected:

```text
HTTP 200
Access-Control-Allow-Origin: https://nexaplayid.store
```

## 8. Systemd dan Monitoring

Service:

- `nexaplay-api.service`
- `nexaplay-catalog-update.service`
- `nexaplay-catalog-update.timer`

Status:

```bash
systemctl status nexaplay-api.service --no-pager
systemctl status nexaplay-catalog-update.timer --no-pager
systemctl list-timers | grep nexaplay
```

Restart API:

```bash
sudo systemctl restart nexaplay-api.service
```

Log:

```bash
journalctl -u nexaplay-api.service -n 100 --no-pager
journalctl -u nexaplay-catalog-update.service -n 100 --no-pager
```

Timer updater:

```ini
OnBootSec=5min
OnUnitActiveSec=5min
RandomizedDelaySec=15s
Persistent=true
```

API dan timer enabled akan hidup kembali setelah reboot. `ExecStartPre` API juga mencoba menjalankan updater sebelum Uvicorn mulai.

## 9. Update Katalog

Alur update:

```text
Catalog Builder / Publisher lokal
        |
        v
catalog_manifest.json + patches di Cloudflare R2
        |
        v
timer VPS membaca manifest
        |
        v
patch diterapkan transaksional ke catalog.sqlite
        |
        v
FastAPI langsung membaca katalog terbaru
```

Jika hanya manifest dan patch berubah:

- Tidak perlu deploy backend.
- Tidak perlu restart API.
- Timer biasanya mengambil update dalam sekitar 5 menit ditambah random delay maksimum 15 detik.

Jalankan updater manual:

```bash
cd /home/nexaplay/nexaplay_web/backend
set -a
source .env
set +a
./.venv/bin/python -m app.update_catalog
```

Contoh jika sudah terbaru:

```json
{
  "status": "NoChange",
  "initial_version": 4,
  "current_version": 4,
  "applied": 0,
  "message": "Catalog already current.",
  "latest_remote_version": 4
}
```

## 10. Pemeriksaan SQLite

```bash
cd /home/nexaplay/nexaplay_web/backend
./.venv/bin/python - <<'PY'
import sqlite3

p = "/home/nexaplay/nexaplay_web/data/catalog.sqlite"
c = sqlite3.connect(p)

print("integrity =", c.execute("PRAGMA integrity_check").fetchone()[0])
print(
    "catalog_version =",
    c.execute(
        "SELECT value FROM catalog_meta WHERE key=?",
        ("catalog_version",),
    ).fetchone()[0],
)
print("games =", c.execute("SELECT COUNT(*) FROM games").fetchone()[0])

c.close()
PY
```

Jangan menjalankan query tulis manual pada database production kecuali ada prosedur pemulihan yang jelas.

## 11. Priority dan Trending

Normal catalog priority berasal dari:

```text
https://raw.githubusercontent.com/adii83/Nexaplay-Metadata-Override/main/appid_populer.json
```

File tersebut hanya berisi urutan AppID. Metadata tetap berasal dari SQLite. Backend menyimpan cache production di:

```text
/home/nexaplay/nexaplay_web/data/priority_appids.json
```

Game Terpopuler berasal dari file lokal:

```text
/home/nexaplay/nexaplay_web/appid_trending.json
```

Setelah mengubah trending:

1. Validasi JSON berupa array AppID positif.
2. Upload file ke path production.
3. Restart API tidak wajib karena endpoint membaca file saat request, tetapi health check tetap dianjurkan.

## 12. Deploy Perubahan Backend

Jika hanya source Python berubah:

1. Upload file yang berubah ke `/home/nexaplay/nexaplay_web/backend/`.
2. Jangan install dependency bila `requirements.txt` tidak berubah.
3. Restart dan verifikasi:

```bash
sudo systemctl restart nexaplay-api.service
systemctl status nexaplay-api.service --no-pager
curl -sS https://api.nexaplayid.store/api/health
```

Jika dependency berubah:

```bash
cd /home/nexaplay/nexaplay_web/backend
./.venv/bin/pip install -r requirements.txt
sudo systemctl restart nexaplay-api.service
```

Jika systemd berubah:

```bash
sudo systemctl daemon-reload
sudo systemctl restart nexaplay-api.service
sudo systemctl restart nexaplay-catalog-update.timer
```

Jika Nginx berubah:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 13. Deploy Frontend

Frontend production berjalan dari GitHub Pages branch `main`.

1. Jalankan test frontend:

```powershell
node --test tests/catalog-data.test.js
```

2. Stage hanya file terkait. Jangan gunakan `git add .` secara default:

```bash
git add -- index.html js/index.js css/index.css
git diff --cached --stat
git commit -m "Update NexaPlay web frontend"
git fetch origin
git status -sb
git push origin main
```

3. Verifikasi:

- `https://nexaplayid.store`
- Browser console tanpa error baru
- Request API menuju `https://api.nexaplayid.store`
- Search, filter, trending, detail, counter, dan mobile layout

## 14. Test Lokal

Backend:

```powershell
cd backend
python -m venv .venv
./.venv/Scripts/pip.exe install -r requirements-dev.txt
./.venv/Scripts/python.exe -B -m unittest discover -s tests -v
```

Frontend:

```powershell
node --test tests/catalog-data.test.js
```

Database production tidak boleh dipakai langsung oleh test. Gunakan fixture atau copy sementara.

## 15. Backup dan Rollback

Sebelum mengganti seed SQLite secara manual:

```bash
sudo systemctl stop nexaplay-api.service nexaplay-catalog-update.timer
sudo cp --preserve=mode,ownership,timestamps \
  /home/nexaplay/nexaplay_web/data/catalog.sqlite \
  "/home/nexaplay/nexaplay_web/data/catalog.sqlite.$(date -u +%Y%m%dT%H%M%SZ).backup"
```

Pemulihan:

1. Hentikan API dan timer.
2. Pulihkan database terakhir yang valid.
3. Jalankan updater manual.
4. Cek integrity dan health pada `127.0.0.1:8010`.
5. Mulai kembali API dan timer.

```bash
sudo systemctl start nexaplay-api.service nexaplay-catalog-update.timer
```

Jangan memakai `git reset --hard`, force-push, atau rewrite history sebagai prosedur rollback operasional.

## 16. Troubleshooting Cepat

### API public gagal tetapi service hidup

```bash
curl -sS http://127.0.0.1:8010/api/health
sudo nginx -t
journalctl -u nginx -n 100 --no-pager
```

Jika local API berhasil tetapi HTTPS gagal, periksa Nginx, DNS, firewall, dan certificate.

### Port bentrok

```bash
sudo ss -ltnp | grep -E ':8000|:8010'
```

Expected:

- Telegram tetap pada port `8000`.
- NexaPlay Web API pada `127.0.0.1:8010`.

### Updater gagal

```bash
journalctl -u nexaplay-catalog-update.service -n 100 --no-pager
curl -I https://meta.nexaplaymetadata.online/catalog/catalog_manifest.json
```

Updater mempertahankan database committed terakhir bila patch invalid atau gagal diterapkan.

### Priority remote gagal

Backend memakai cache last-known-good. Jika remote dan cache sama-sama tidak tersedia, browse tetap berjalan memakai urutan SQLite.

### CORS gagal

Pastikan `NEXAPLAY_ALLOWED_ORIGINS` berisi origin exact tanpa path tambahan, lalu restart API.

## 17. Sistem Legacy yang Sudah Dihapus

Berikut bukan bagian dari production dan tidak boleh dibuat ulang:

- `web_catalog_builder/`
- Browser runtime `catalog.json`
- `chunks/`
- Legacy `search_index.json`
- Sync NexaPlay Web Catalog bot/workflow
- `generate-catalog-manifest` GitHub Action lama
- `nexaplay-catalog-bot`
- Browser direct-fetch metadata R2 sebagai sumber katalog utama

Dokumen di `docs/superpowers/` menyimpan sejarah desain lama dan ditandai obsolete. Jangan menjalankan instruksinya.

## 18. Checklist Maintenance

- [ ] `nexaplay-api.service` active
- [ ] `nexaplay-catalog-update.timer` active
- [ ] Local health `127.0.0.1:8010` berhasil
- [ ] Public health HTTPS berhasil
- [ ] CORS mengembalikan origin website
- [ ] SQLite integrity `ok`
- [ ] Catalog version sesuai manifest
- [ ] Nginx config valid
- [ ] Certbot timer aktif
- [ ] Telegram tetap memakai port `8000`
- [ ] NexaPlay Web tetap memakai port `8010`
- [ ] Tidak ada secret atau SQLite production di Git
