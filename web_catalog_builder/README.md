# Web Catalog Builder

Generator ini sekarang memakai `games_list.json` sebagai base utama.

## Input base

Setiap item minimal punya:

- `appid`
- `title`
- `premium`

## Enrichment yang ditambahkan

Script akan menambahkan:

- `cover_url`
- `publishers`
- `genres`
- `specification.minimum`
- `specification.recommended`

## Fallback cover

Urutan fallback cover:

1. `nexaplay_override.json`
2. `assets.library_capsule`
3. `assets.library_capsule_2x`
4. `assets.header`
5. `"NO CONTENT"`

## Output final

Contoh format akhir:

```json
[
  {
    "appid": 3489700,
    "title": "Stellar Blade™",
    "premium": true,
    "cover_url": "https://...",
    "publishers": ["Sony Interactive Entertainment"],
    "genres": ["Action", "Adventure"],
    "specification": {
      "minimum": "<strong>Minimum:</strong> ...",
      "recommended": "<strong>Recommended:</strong> ..."
    }
  }
]
```

## Cara menjalankan

Dari root project:

```powershell
python .\web_catalog_builder\build_web_catalog.py
```

Test kecil dulu:

```powershell
python .\web_catalog_builder\build_web_catalog.py --limit 20
```

Tanpa chunk:

```powershell
python .\web_catalog_builder\build_web_catalog.py --no-chunks
```

Mulai ulang dari nol:

```powershell
python .\web_catalog_builder\build_web_catalog.py --no-resume
```

## Resume

Script mendukung pause/resume otomatis:

- progress sementara disimpan di `output/resume_state.json`
- kalau proses berhenti di tengah, jalankan perintah yang sama lagi
- kalau selesai normal, file resume dihapus otomatis

## Default source

- Base list: `web_catalog_builder/games_list.json`
- Metadata lokal: `D:\My Project\___Metadata Nexaplay Cloudfare R2\Metadata`
- Override cover: `nexaplay_override.json`
