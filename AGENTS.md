# NexaPlay Web Project Notes

Dokumentasi aktif dimulai dari `README.md` dan `Tutorial.md`.

Arsitektur production:

- GitHub Pages frontend: `https://nexaplayid.store`
- FastAPI melalui Nginx: `https://api.nexaplayid.store`
- FastAPI internal: `127.0.0.1:8010`
- SQLite: `/home/nexaplay/nexaplay_web/data/catalog.sqlite`
- Port `8000` tetap milik service Telegram lama

Jangan membuat ulang `web_catalog_builder/`, static catalog/chunks, legacy search index, atau workflow sync web lama. Metadata website berasal dari SQLite/API.

`graphify-out/` sudah dihapus dan bukan dependency project.
