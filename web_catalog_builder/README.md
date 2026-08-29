# Web Catalog Builder

`games_list.json` adalah master list ringkas untuk semua game yang sudah diterima website. Builder menghasilkan search index statis; detail game diambil live dari R2 saat modal dibuka.

## Menjalankan builder

Dari root repository:

```bash
python web_catalog_builder/build_index.py --check
python web_catalog_builder/build_index.py
```

`--check` memvalidasi input dan output tanpa menulis file. Jalankan perintah kedua setelah pemeriksaan lulus untuk memperbarui `web_catalog_builder/output/search_index.json`.

## Search index

Setiap baris memakai tuple empat field:

```text
[appid, title, premium_flag, cover_data]
```

- `appid`: integer.
- `title`: string non-empty.
- `premium_flag`: `0` untuk Standard atau `1` untuk Premium.
- `cover_data`: URL absolut, path asset relatif Steam CDN, atau string kosong.

Search index hanya memuat data untuk card, pencarian, filter, hero, dan trending. Field chunk lama tidak dipakai.

## Detail live dari R2

Saat card dibuka, frontend meminta:

```text
https://meta.nexaplaymetadata.online/Metadata/{appid}.json
```

Detail publisher, genre, requirements, dan asset modal berasal dari respons tersebut. Frontend menggabungkannya per field dengan normalized override dari origin website; nilai override yang tersedia menang tanpa mengganti field lain atau menulis balik ke R2.

## Output sinkronisasi

Workflow katalog menjaga empat file:

- `web_catalog_builder/games_list.json`: master list durable.
- `web_catalog_builder/output/search_index.json`: tuple empat field untuk browser.
- `web_catalog_builder/output/overrides.json`: projection ringkas dari `nexaplay_override.json`, keyed by string AppID dan tetap sparse.
- `web_catalog_builder/output/r2_manifest.json`: manifest versioned berisi ETag dan `LastModified` untuk scan incremental.

Game yang sudah ada mempertahankan klasifikasi Premium/Standard. Menghapus AppID dari admission list atau objek R2 tidak otomatis menghapus game website.

## Rollback produksi

`web_catalog_builder/output/catalog.json` dan `web_catalog_builder/output/chunks/` tetap rollback-only sampai alur hybrid terverifikasi di produksi. Jangan regenerate atau hapus aset lama saat membangun search index. Hapus catalog penuh, chunks, generator chunks, dan fallback frontend hanya setelah card, search/filter, modal detail R2, normalized override, caching, serta CORS berhasil diverifikasi.
