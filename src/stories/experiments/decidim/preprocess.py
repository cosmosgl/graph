"""
Offline preprocessing for the "Decidim Proposals" embedding story.

Reads the raw 768-dim proposal embeddings + metadata parquet and writes the
compact binaries the browser story loads. The browser can't read parquet, and
the point of the story is to compare the GPU UMAP / t-SNE *layout* kernels
against a precomputed UMAP — so the expensive, layout-independent preprocessing
(the kNN graph and the PCA init) is done here, once, not in the browser:

  knn_idx.u16.bin   uint16   n × K   neighbor indices (self excluded), ascending
  knn_dist.f32.bin  float32  n × K   matching euclidean distances (unit-normed)
  init.f32.bin      float32  n × 2   PCA-2D init positions (raw, unscaled)
  precomputed.f32.bin float32 n × 2  the parquet's stored UMAP x / y (raw)
  topic.i16.bin     int16    n       topic id (-1 = generic / uncategorized)
  supports.f32.bin  float32  n       support count (for point sizing)
  meta.json         { n, k, topics: [{id, label, count}], supportsMax }

kNN is on L2-normalized embeddings (euclidean rank == cosine, the usual metric
for sentence embeddings). K is large enough to cover the story's UMAP
n_neighbors and t-SNE k = 3·perplexity.

Run from the repo root (edit SRC to the parquet path):
  python3 src/stories/experiments/decidim/preprocess.py
"""
import json
import os

import numpy as np
import pyarrow.parquet as pq

SRC = os.environ.get(
    'DECIDIM_PARQUET',
    os.path.expanduser('~/Library/Application Support/Claude/local-agent-mode-sessions/'
                        'f2056a4b-db3f-4943-88ee-ac4945e7f781/8b850cdb-766a-45cf-8ef4-450117d0b183/'
                        'local_f90c6d60-3bae-463a-83e9-08afbd0dbece/outputs/'
                        'decidim-barcelona-proposals-embeddings-768d.parquet'),
)
OUT = os.path.dirname(__file__)
K = 64


def exact_knn(x: np.ndarray, k: int, block: int = 1024) -> tuple[np.ndarray, np.ndarray]:
    """Exact k nearest neighbors (self excluded), blockwise to bound memory."""
    n = x.shape[0]
    sq = (x ** 2).sum(axis=1)
    idx = np.empty((n, k), dtype=np.int32)
    dist = np.empty((n, k), dtype=np.float32)
    for start in range(0, n, block):
        end = min(start + block, n)
        d2 = sq[start:end, None] + sq[None, :] - 2.0 * (x[start:end] @ x.T)
        d2[np.arange(end - start), np.arange(start, end)] = np.inf
        part = np.argpartition(d2, k, axis=1)[:, :k]
        order = np.take_along_axis(d2, part, axis=1).argsort(axis=1)
        nn = np.take_along_axis(part, order, axis=1)
        idx[start:end] = nn
        dist[start:end] = np.sqrt(np.maximum(0.0, np.take_along_axis(d2, nn, axis=1))).astype(np.float32)
        print(f'  kNN {end}/{n}', end='\r')
    print()
    return idx, dist


def main() -> None:
    t = pq.read_table(SRC).to_pydict()
    n = len(t['id'])
    print(f'{n} proposals, 768-dim embeddings')

    emb = np.asarray(t['embedding'], dtype=np.float32)  # n × 768
    emb /= np.maximum(1e-8, np.linalg.norm(emb, axis=1, keepdims=True))

    idx, dist = exact_knn(emb, K)
    assert n < 65536, 'uint16 neighbor indices require n < 65536'
    idx.astype(np.uint16).tofile(os.path.join(OUT, 'knn_idx.u16.bin'))
    dist.tofile(os.path.join(OUT, 'knn_dist.f32.bin'))

    # PCA-2D init from the top 2 principal components of the embeddings.
    centered = emb - emb.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    init = (centered @ vt[:2].T).astype(np.float32)
    init.tofile(os.path.join(OUT, 'init.f32.bin'))

    precomputed = np.stack([t['x'], t['y']], axis=1).astype(np.float32)
    precomputed.tofile(os.path.join(OUT, 'precomputed.f32.bin'))

    topic = np.asarray(t['topic'], dtype=np.int16)
    topic.tofile(os.path.join(OUT, 'topic.i16.bin'))

    supports = np.asarray(t['supports'], dtype=np.float32)
    supports.tofile(os.path.join(OUT, 'supports.f32.bin'))

    # Topic labels + counts for the legend (kept only for the labelled topics).
    labels: dict[int, str] = {}
    for tid, lab in zip(t['topic'], t['topic_label_str']):
        labels.setdefault(int(tid), lab or '')
    counts = np.bincount(topic - topic.min()) if n else np.array([])
    topics = []
    for tid in sorted(labels):
        topics.append({'id': tid, 'label': labels[tid], 'count': int((topic == tid).sum())})

    meta = {'n': n, 'k': K, 'supportsMax': float(supports.max()), 'topics': topics}
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)

    total = sum(os.path.getsize(os.path.join(OUT, b)) for b in [
        'knn_idx.u16.bin', 'knn_dist.f32.bin', 'init.f32.bin',
        'precomputed.f32.bin', 'topic.i16.bin', 'supports.f32.bin',
    ])
    print(f'wrote bins ({total / 1e6:.1f} MB) + meta.json ({len(topics)} topics)')


if __name__ == '__main__':
    main()
