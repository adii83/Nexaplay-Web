Status keamanan saat ini

Aman pada level kode dan test lokal:

- Indeks: 146.846 game valid
- Builder: 19/19 lulus
- Synchronizer: 24/24 lulus
- Adapter browser: 16/16 lulus
- Total: 59/59 lulus
- Atomic write dan rollback multi-file ikut diuji.
- ETag retry, invalid metadata, duplicate AppID, override, dan kegagalan replace ikut diuji.

Belum dapat disebut terverifikasi produksi sampai empat hal diuji lewat GitHub:

1. Secret R2 benar.
2. NEXAPLAY_WEB_TOKEN bisa push ke adii83/Nexaplay-Web.
3. CORS R2 menerima https://nexaplayid.store.
4. Manual dry-run dan satu production run berhasil.

Berikut urutan aman dari awal.

---

Fase 1 — Siapkan perubahan Nexaplay-Web

GitHub Action akan checkout adii83/Nexaplay-Web dari GitHub, bukan membaca working tree lokal. Jadi perubahan hybrid web harus sudah masuk main sebelum production run.

1.1 Pastikan file runtime masuk commit

File penting:

index.html
showcase.html
js/index.js
js/catalog-data.js
assets/favicon.png
assets/favicon.svg
tests/catalog-data.test.js
web_catalog_builder/build_index.py
web_catalog_builder/catalog_index.py
web_catalog_builder/README.md
web_catalog_builder/tests/
web_catalog_builder/output/search_index.json
web_catalog_builder/output/overrides.json

Jangan langsung memakai:

git add .

Working tree juga mengandung .claude/, graphify-out/, dan artefak tooling lain.

1.2 Jalankan validasi

Dari root Nexaplay-Web
python -m unittest discover \
  -s web_catalog_builder/tests \
  -p "test_*.py" \
  -v

python -m unittest discover \
  -s integrations/nexaplay-metadata-override/tests \
  -p "test_*.py" \
  -v

node --test tests/catalog-data.test.js

Hasil yang diharapkan:

Validated 146846 unique games with four-field tuples
19 Python builder tests OK
24 synchronizer tests OK
16 Node tests pass

1.3 Buat branch dan commit selektif

git switch -c r2-hybrid-catalog

Stage file runtime:
  web_catalog_builder/catalog_index.py \
  web_catalog_builder/README.md \
  web_catalog_builder/tests \
  web_catalog_builder/output/search_index.json \
  web_catalog_builder/output/overrides.json

Opsional: simpan source bundle integrasi dan dokumentasinya di repository web:

git add -- \
  integrations/nexaplay-metadata-override \
  docs/superpowers

Periksa sebelum commit:

git status --short
git diff --cached --stat

Commit dan push:

git commit -m "Add hybrid R2 catalog synchronization"
git push -u origin r2-hybrid-catalog

Buka Pull Request menuju main, periksa diff, lalu merge. Setelah merge:

git switch main
git pull --ff-only origin main

Pastikan js/catalog-data.js dan assets/favicon.* ikut masuk. Commit parsial tanpa file tersebut me

adii83/Nexaplay-Metadata-Override

Struktur final:

Nexaplay-Metadata-Override/
├── .github/
│   └── workflows/
│       └── sync-nexaplay-web.yml
├── scripts/
│   └── sync_nexaplay_web.py
├── tests/
│   └── test_sync_nexaplay_web.py
├── docs/
│   └── nexaplay-web-sync.md
├── new_games.json
└── nexaplay_override.json

2.1 Clone repository metadata

git clone https://github.com/adii83/Nexaplay-Metadata-Override.git
cd Nexaplay-Metadata-Override

Pastikan file sumber sudah ada:

new_games.json
nexaplay_override.json

Synchronizer memperlakukan:

- new_games.json sebagai izin memasukkan game baru.
- nexaplay_override.json sebagai koreksi metadata.
- Penghapusan AppID dari new_games.json tidak menghapus game website.

---

Fase 3 — Matikan Actions sementara

Ini langkah penting.

Workflow saat ini punya trigger:

on:
  push:
    branches: [main]

Manual dry_run: true hanya berlaku untuk workflow_dispatch. Push pertama ke main akan menjalankan production sync, bukan dry-run.

Sebelum memindahkan file:

1. Buka adii83/Nexaplay-Metadata-Override.
2. Masuk Settings.
3. Pilih Actions → General.
4. Pada Actions permissions, pilih Disable actions.
5. Simpan.

Tujuan: push instalasi workflow tidak langsung menulis ke repository web.

Push yang terjadi saat Actions dinonaktifkan tidak dijalankan ulang otomatis setelah Actions diaktifkan.

---

Fase 4 — Salin bundle integrasi

Pilihan A — PowerShell Windows

Sesuaikan $meta dengan lokasi clone repository metadata:

$web = "D:\My Project\NEXAPLAY\Apps\__Web_Nexaplay"
$meta = "D:\My Project\NEXAPLAY\Apps\Nexaplay-Metadata-Override"

New-Item -ItemType Directory -Force "$meta\scripts" | Out-Null
New-Item -ItemType Directory -Force "$meta\tests" | Out-Null
New-Item -ItemType Directory -Force "$meta\.github\workflows" | Out-Null
New-Item -ItemType Directory -Force "$meta\docs" | Out-Null

Copy-Item `
  "$web\integrations\nexaplay-metadata-override\scripts\sync_nexaplay_web.py" `
  "$meta\scripts\sync_nexaplay_web.py"

Copy-Item `
  "$web\integrations\nexaplay-metadata-override\tests\test_sync_nexaplay_web.py" `
  "$meta\tests\test_sync_nexaplay_web.py"

Copy-Item `
  "$web\integrations\nexaplay-metadata-override\.github\workflows\sync-nexaplay-web.yml" `
  "$meta\.github\workflows\sync-nexaplay-web.yml"

Copy-Item `
  "$web\integrations\nexaplay-metadata-override\README.md" `
  "$meta\docs\nexaplay-web-sync.md"

Pilihan B — Git Bash/Linux

Dijalankan dari root Nexaplay-Web:

META="../Nexaplay-Metadata-Override"

mkdir -p \
  "$META/scripts" \
  "$META/tests" \
  "$META/.github/workflows" \
  "$META/docs"

cp integrations/nexaplay-metadata-override/scripts/sync_nexaplay_web.py \
  "$META/scripts/"

cp integrations/nexaplay-metadata-override/tests/test_sync_nexaplay_web.py \
  "$META/tests/"

cp integrations/nexaplay-metadata-override/.github/workflows/sync-nexaplay-web.yml \
  "$META/.github/workflows/"

cp integrations/nexaplay-metadata-override/README.md \
  "$META/docs/nexaplay-web-sync.md"

---

Fase 5 — Uji hasil salinan

Masuk repository metadata:

cd ../Nexaplay-Metadata-Override

Jalankan test:

Ran 24 tests
OK

Periksa CLI:

python scripts/sync_nexaplay_web.py --help

Periksa file:

git status --short

File baru yang diharapkan:

.github/workflows/sync-nexaplay-web.yml
scripts/sync_nexaplay_web.py
tests/test_sync_nexaplay_web.py
docs/nexaplay-web-sync.md

---

Fase 6 — Buat token Cloudflare R2

6.1 Buat R2 API token read-only

Di Cloudflare Dashboard:

1. Buka R2 Object Storage.
2. Pilih Manage R2 API Tokens.
3. Pilih Create API token.
4. Batasi ke bucket metadata.
5. Berikan izin minimum:
   - Object Delete
   - Bucket Write
7. Simpan nilai:
   - Access Key ID
   - Secret Access Key

Secret Access Key biasanya hanya ditampilkan sekali.

6.2 Catat informasi R2

Diperlukan:

R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME

Jangan memasukkan nilai tersebut ke file YAML, commit, dokumentasi, atau log.

---

Fase 7 — Buat token GitHub untuk repository web

Workflow berjalan di repository metadata, tetapi harus push ke repository web.

7.1 Buat fine-grained PAT

Di GitHub:

1. Klik foto profil.
6. Generate new token.
7. Resource owner: akun adii83.
8. Repository access: Only select repositories.
9. Pilih:
adii83/Nexaplay-Web
10. Repository permissions:
Contents: Read and write
11. Metadata tetap read-only otomatis.
12. Pilih masa berlaku.
13. Generate dan salin token.

Nama secret nanti:

NEXAPLAY_WEB_TOKEN

Jangan memakai token R2 untuk ini. Jangan memakai GITHUB_TOKEN repository metadata karena token tersebut tidak otomatis dapat menulis repository lain.

7.2 Periksa branch protection

Di adii83/Nexaplay-Web:

Settings → Branches / Rules → main

Workflow saat ini melakukan:

git push origin HEAD:main

Jika main melarang direct push tanpa pengecualian, production sync akan gagal. Pilihan:

- Izinkan pemilik token/bot melewati rule; atau
- Ubah workflow agar membuat Pull Request.

Workflow sekarang dirancang untuk direct push biasa tanpa force push.

---

Fase 8 — Tambahkan repository secrets

Buka:

adii83/Nexaplay-Metadata-Override
→ Settings
→ Secrets and variables
→ Actions
→ Repository secrets

Tambahkan lima secret:

R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
NEXAPLAY_WEB_TOKEN

Periksa:

- Nama harus persis sama.
- Jangan ada spasi tambahan.
- NEXAPLAY_WEB_TOKEN menunjuk token GitHub, bukan token R2.
- R2 token read-only.

---

Fase 9 — Atur CORS Cloudflare R2

Ini diperlukan agar browser nexaplayid.store bisa mengambil detail metadata.

Pasang CORS policy pada bucket metadata:

[
  {
    "AllowedOrigins": ["https://nexaplayid.store"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]

Pastikan origin tepat:

https://nexaplayid.store

Jika situs juga memakai www, tambahkan eksplisit:

"AllowedOrigins": [
  "https://nexaplayid.store",
  "https://www.nexaplayid.store"
]

Jangan memakai * jika tidak dibutuhkan.

Uji satu objek lewat browser setelah deployment:

https://meta.nexaplaymetadata.online/Metadata/<APPID>.json

Target:

- Status 200.
- Tidak ada error CORS.
- Response JSON valid.
- Header CORS mengizinkan domain website.

---

Fase 10 — Commit bundle ke repository metadata

Actions masih harus dalam kondisi dinonaktifkan.

Dari root Nexaplay-Metadata-Override:

git switch -c nexaplay-web-catalog-sync

Stage file:

git add -- \
  .github/workflows/sync-nexaplay-web.yml \
  scripts/sync_nexaplay_web.py \
  tests/test_sync_nexaplay_web.py \
  docs/nexaplay-web-sync.md

Periksa:

git status --short
git diff --cached --stat

Commit:

git commit -m "Add NexaPlay web catalog synchronization"
git push -u origin nexaplay-web-catalog-sync

Buka Pull Request ke main. Karena Actions dinonaktifkan, merge tidak menjalankan workflow.

Setelah merge:

git switch main
adii83/Nexaplay-Metadata-Override/.github/workflows/sync-nexaplay-web.yml

---

Fase 11 — Aktifkan GitHub Actions

Di adii83/Nexaplay-Metadata-Override:

1. Settings.
2. Actions → General.
3. Aktifkan Actions kembali.
4. Izinkan actions yang dibutuhkan.
5. Simpan.

Lakukan ini tidak berdekatan dengan jadwal 02:17 UTC, agar ada waktu menjalankan dry-run.

Konversi waktu:

02:17 UTC = 09:17 WIB
02:17 UTC = 10:17 WITA
02:17 UTC = 11:17 WIT

---

Fase 12 — Jalankan dry-run pertama

Buka:

adii83/Nexaplay-Metadata-Override
→ Actions
→ Sync NexaPlay Web Catalog
→ Run workflow

Pilih:

Branch: main
dry_run: true

Klik Run workflow.

12.1 Langkah yang harus hijau

Workflow harus melewati:

Checkout metadata source
Test synchronizer
Checkout NexaPlay Web
List R2 metadata objects
Synchronize catalog

Langkah berikut harus dilewati pada dry-run:

Commit and push generated catalog

Ini benar karena dry-run tidak boleh menulis repository web.

12.2 Periksa log

Pastikan tidak ada:

403 Forbidden
AccessDenied
Repository not found
Bad credentials
CORS error
invalid metadata
duplicate AppID
missing existing index

Dry-run tetap:

- Membaca listing R2.
- Mengambil metadata yang diperlukan.
- Menjalankan validasi.
- Menghitung perubahan.
- Tidak commit dan tidak push.

12.3 Jika dry-run gagal

Jangan jalankan dry_run: false.

Pemetaan error umum:

┌─────────────────────────┬────────────────────────────────────────────┐
│          Error          │                  Periksa                   │
├─────────────────────────┼────────────────────────────────────────────┤
│ AccessDenied saat list  │ R2_ACCESS_KEY_ID, secret, bucket, Bucket   │
│ R2                      │ List                                       │
├─────────────────────────┼────────────────────────────────────────────┤
│ NoSuchBucket            │ R2_BUCKET_NAME                             │
├─────────────────────────┼────────────────────────────────────────────┤
│ Repository not found    │ akses NEXAPLAY_WEB_TOKEN                   │
├─────────────────────────┼────────────────────────────────────────────┤
│ 403 saat checkout web   │ token kedaluwarsa atau repo belum dipilih  │
├─────────────────────────┼────────────────────────────────────────────┤
│ Tests gagal             │ file script/test/workflow tidak sinkron    │
├─────────────────────────┼────────────────────────────────────────────┤
│ Existing index missing  │ perubahan web belum merged ke main         │
├─────────────────────────┼────────────────────────────────────────────┤
│ Builder/import gagal    │ catalog_index.py belum masuk repository    │
│                         │ web                                        │
├─────────────────────────┼────────────────────────────────────────────┤
│ Duplicate AppID         │ data games_list.json atau new_games.json   │
│                         │ invalid                                    │
└─────────────────────────┴────────────────────────────────────────────┘

---

Fase 13 — Jalankan production sync pertama

Hanya setelah dry-run hijau.

Buka workflow lagi:

Actions
→ Sync NexaPlay Web Catalog
→ Run workflow

Pilih:

Branch: main
dry_run: false

Production run akan:

1. Checkout repository metadata.
2. Menjalankan 24 test synchronizer.
3. Checkout adii83/Nexaplay-Web.
4. Mengambil listing R2.
5. Membangun baseline ETag.
6. Mengambil metadata hanya untuk:
   - AppID baru yang diizinkan;
   - game dengan override aktif;
   - objek yang perlu diproses.
7. Menulis empat output:
web_catalog_builder/games_list.json
web_catalog_builder/output/search_index.json
web_catalog_builder/output/overrides.json
web_catalog_builder/output/r2_manifest.json
8. Membuat commit:
Sync NexaPlay web catalog
9. Menjalankan:
git pull --rebase origin main
git push origin HEAD:main
 dan LastModified sebagai baseline.

---

Fase 14 — Verifikasi hasil production

14.1 Periksa repository web

Buka commit history adii83/Nexaplay-Web.

Cari commit:

Sync NexaPlay web catalog

Periksa hanya empat output yang berubah:

web_catalog_builder/games_list.json
web_catalog_builder/output/search_index.json
web_catalog_builder/output/overrides.json
web_catalog_builder/output/r2_manifest.json

Jika tidak ada perubahan, workflow akan menampilkan:

No catalog changes

Itu normal.

14.2 Periksa manifest

Pastikan file ini dibuat:

web_catalog_builder/output/r2_manifest.json

Manifest harus menyimpan state objek seperti:

{
  "etag": "object-etag",
  "last_modified": "ISO-8601 timestamp"
}

Jangan menghapus manifest. Tanpa manifest, run berikut dapat dianggap baseline baru.

14.3 Periksa website

Buka https://nexaplayid.store, lalu:

1. Pastikan halaman katalog tampil.
2. Cari game berdasarkan judul.
3. Cari game berdasarkan AppID.
4. Uji filter Premium.
5. Uji filter Standard.
6. Buka satu modal game.
7. Periksa title dan cover.
8. Periksa developer, publisher, genre, dan requirement.
9. Tutup lalu buka game lain dengan cepat.
10. Pastikan detail game pertama tidak menimpa game kedua.
11. Buka DevTools → Network.
12. Pastikan request:
/Metadata/<appid>.json
    mendapat 200.
13. Pastikan tidak ada error CORS.
14. Uji mobile/modal focus dan Escape.

14.4 Periksa fallback

Jika metadata satu game tidak tersedia:

- Kartu tetap tampil.
- Modal tetap terbuka.
- Title/cover dasar berasal dari search index.
- Teks “Detail belum tersed
- Seluruh katalog tidak ikut gagal.

---

Fase 15 — Biarkan schedule aktif

Setelah production run pertama lulus, tidak perlu perubahan tambahan.

Workflow berjalan:

schedule:
  - cron: "17 2 * * *"

Artinya setiap hari sekitar:

02:17 UTC
09:17 WIB
10:17 WITA
11:17 WIT

GitHub cron dapat terlambat beberapa menit saat runner sibuk.

Trigger lain:

push ke main saat new_games.json berubah
push ke main saat nexaplay_override.json berubah
perubahan script/test/workflow
manual workflow_dispatch

concurrency mencegah dua sinkronisasi berjalan bersamaan:

group: nexaplay-web-catalog-sync
cancel-in-progress: false

---

Fase 16 — Operasional harian

Menambah game baru

1. Tambahkan AppID ke:
new_games.json
2. Commit dan push ke main repository metadata.
3. Workflow otomatis berjalan.
4. Game ditambahkan hanya jika metadata valid.
5. Setelah berhasil, output repository web diperbarui.

Objek R2 baru saja tidak otomatis masuk katalog. AppID tetap harus diizinkan melalui new_games.json.

Mengubah metadata

Jika file Metadata/<appid>.json berubah:

1. ETag berubah.
2. Scheduled run mendeteksi perubahan.
3. Hanya metadata tersebut yang diunduh.
4. Search index dan master diperbarui jika diperlukan.
5. Premium/Standard game lama dipertahankan.

Menambah override

1. Edit:
nexaplay_override.json
2. Commit ke main.
3. Workflow langsung berjalan.
4. Projection ditulis ke:
web_catalog_builder/output/overrides.json

---

Fase 17 — Rollback aman

Jika data hasil sync salah

1. Disable workflow:
Actions → Sync NexaPlay Web Catalog → Disable workflow
2. Di repository web, revert commit bot:
git revert <hash-commit-sync>
git push origin main
3. Perbaiki data atau script.
4. Jalankan manual dry-run lagi.
5. Aktifkan kembali setelah valid.

Jangan memakai:

git push --force
git reset --hard origin/main

Jika runtime hybrid bermasalah

Pertahankan sementara:

web_catalog_builder/output/catalog.json
web_catalog_builder/output/chunks/

Jangan hapus jalur lama sampai hal berikut terverifikasi produksi:

- Card
- Search
- Filter
- Modal R2
- Override
- Cache
- CORS
- Fallback

Jika perlu rollback total, revert commit fitur hybrid web, bukan hanya commit hasil sync.


- [ ] Workflow di .github/workflows/
- [ ] Script di scripts/
- [ ] Test di tests/
- [ ] Dokumentasi di docs/
- [ ] new_games.json tersedia
- [ ] nexaplay_override.json tersedia

GitHub dan R2

- [ ] Lima secret tersedia
- [ ] R2 token read-only
- [ ] PAT hanya untuk Nexaplay-Web
- [ ] PAT punya Contents: Read and write
- [ ] Branch protection mengizinkan bot push
- [ ] CORS R2 benar

Aktivasi

- [ ] Actions dimatikan saat instalasi
- [ ] Bundle sudah merged
- [ ] Actions diaktifkan kembali
- [ ] Manual dry-run hijau
- [ ] Manual production run hijau
- [ ] Commit bot muncul di repository web
- [ ] Modal metadata berhasil di website
- [ ] Schedule harian aktif

Urutan paling penting: merge perubahan web → matikan Actions → pindahkan workflow → pasang secrets → aktifkan Actions → dry-run → production run → verifikasi website.