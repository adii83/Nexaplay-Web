import json

CHUNK_SIZE = 1000

print("Reading catalog.json...")
with open("output/catalog.json", "r", encoding="utf-8") as f:
    items = json.load(f)

print("Building index...")
search_index = []
for index, item in enumerate(items):
    chunk_index = (index // CHUNK_SIZE) + 1
    search_index.append({
        "appid": item["appid"],
        "title": item["title"],
        "premium": item["premium"],
        "cover_url": item["cover_url"],
        "chunk": chunk_index
    })

print("Writing search_index.json...")
with open("output/search_index.json", "w", encoding="utf-8") as f:
    json.dump(search_index, f, ensure_ascii=False, separators=(',', ':'))

print("Done.")
