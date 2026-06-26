import json
import os
import shutil

CHUNK_SIZE = 100

print("Reading catalog.json...")
with open("output/catalog.json", "r", encoding="utf-8") as f:
    items = json.load(f)

chunks_dir = "output/chunks"
if os.path.exists(chunks_dir):
    shutil.rmtree(chunks_dir)
os.makedirs(chunks_dir)

print("Building index and chunks...")
search_index = []
current_chunk = []
chunk_index = 1

def write_chunk(idx, data):
    with open(f"{chunks_dir}/catalog-{idx:04d}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

for item in items:
    current_chunk.append(item)
    search_index.append({
        "appid": item["appid"],
        "title": item["title"],
        "premium": item["premium"],
        "cover_url": item["cover_url"],
        "chunk": chunk_index
    })
    
    if len(current_chunk) >= CHUNK_SIZE:
        write_chunk(chunk_index, current_chunk)
        chunk_index += 1
        current_chunk = []

if current_chunk:
    write_chunk(chunk_index, current_chunk)

print("Writing search_index.json...")
with open("output/search_index.json", "w", encoding="utf-8") as f:
    json.dump(search_index, f, ensure_ascii=False, separators=(',', ':'))

print("Done.")
