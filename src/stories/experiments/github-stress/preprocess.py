"""
One-time conversion of github-repos-100k.parquet into compact binaries the
stress-test story loads in the browser. This does the minimum a browser can't:
read the 96MB parquet and turn the raw embeddings into a small loadable form.
Everything else — PCA (dimensionality reduction + 2D init), kNN, the fuzzy graph,
and the UMAP optimization — runs client-side.

Outputs (to ./data/):
  embeddings.i8.bin  int8   n*256   L2-normalized embeddings, quantized (cosine)
  lang.u8.bin        uint8  n       primaryLanguage -> palette index (see LANGS)
  stars.f32.bin      f32    n       stars (for log-size)
  meta.json                         { n, dim, langs }

Run once from the repo root:  python3 src/stories/experiments/github-stress/preprocess.py
"""
import json, os, time
import numpy as np
import pyarrow.parquet as pq

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, 'github-repos-100k.parquet')
OUT = os.path.join(HERE, 'data')
DIM = 256
# Palette languages (index = position; anything else -> "Other" = last index).
LANGS = ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C', 'C#', 'Go', 'Rust',
         'PHP', 'Ruby', 'Shell', 'HTML', 'Swift', 'Kotlin', 'Other']

t0 = time.time()
tbl = pq.read_table(SRC, columns=['embedding', 'primaryLanguage', 'stars'])
n = tbl.num_rows
print(f'read {n} rows in {time.time() - t0:.1f}s')

emb = tbl['embedding'].combine_chunks().flatten().to_numpy(zero_copy_only=False).reshape(n, DIM).astype(np.float32)
# L2-normalize (cosine metric), then int8-quantize.
emb /= np.linalg.norm(emb, axis=1, keepdims=True) + 1e-9
q = np.clip(np.round(emb * 127.0), -127, 127).astype(np.int8)

lang_index = {name: i for i, name in enumerate(LANGS)}
other = len(LANGS) - 1
lang_u8 = np.array([lang_index.get(l, other) for l in tbl['primaryLanguage'].to_pylist()], dtype=np.uint8)
stars = np.array(tbl['stars'].to_pylist(), dtype=np.float32)

os.makedirs(OUT, exist_ok=True)
q.tofile(os.path.join(OUT, 'embeddings.i8.bin'))
lang_u8.tofile(os.path.join(OUT, 'lang.u8.bin'))
stars.tofile(os.path.join(OUT, 'stars.f32.bin'))
json.dump({'n': int(n), 'dim': DIM, 'langs': LANGS, 'metric': 'cosine'},
          open(os.path.join(OUT, 'meta.json'), 'w'))

print('sizes:')
for f in ['embeddings.i8.bin', 'lang.u8.bin', 'stars.f32.bin']:
    print(f'  {f}: {os.path.getsize(os.path.join(OUT, f)) / 1e6:.1f} MB')
print(f'total {time.time() - t0:.1f}s')
