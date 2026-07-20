"""
Reference-quality benchmark for the cosmos.gl embedding kernels.

Runs umap-learn and openTSNE on the mammoth point cloud (the same data the
Storybook examples embed) with hyperparameters matched to the in-browser
benchmark story, computes embedding-quality metrics, and writes them to
benchmark-reference.json — which the "Embedding Quality Benchmark" story loads
to display reference numbers next to the GPU kernels' live results.

Metrics (identical definitions to the story's JS implementation):
  - knn recall@k: fraction of a point's true k nearest neighbors in the INPUT
    space that are also among its k nearest neighbors in the EMBEDDING.
  - trustworthiness@k (Venna & Kaski): penalizes "intruders" — embedding
    neighbors that are far in the input space — weighted by input-space rank.
    Computed on a fixed random sample of queries (exact over all candidates).

A PCA-2D baseline row is included: it answers "does the embedding beat plain
PCA", and doubles as a parity check for the JS metric code (the story computes
the same metrics on its PCA init; rank-based metrics are scale-invariant, so
the numbers must match).

Run once from the repo root:
  python3 src/stories/experiments/umap-embedding/benchmark-reference.py
"""
import json
import os
import time

import numpy as np

HERE = os.path.dirname(__file__)
UMAP_N_NEIGHBORS = 25
UMAP_MIN_DIST = 0.1
TSNE_PERPLEXITY = 20
RECALL_KS = (10, 30)
TRUST_K = 10
TRUST_SAMPLE = 2000
SEED = 42


def exact_knn(x: np.ndarray, k: int, block: int = 1024) -> np.ndarray:
    """Exact k nearest neighbors (excluding self), blockwise to bound memory."""
    n = x.shape[0]
    sq = (x ** 2).sum(axis=1)
    out = np.empty((n, k), dtype=np.int32)
    for start in range(0, n, block):
        end = min(start + block, n)
        d2 = sq[start:end, None] + sq[None, :] - 2.0 * (x[start:end] @ x.T)
        d2[np.arange(end - start), np.arange(start, end)] = np.inf
        part = np.argpartition(d2, k, axis=1)[:, :k]
        order = np.take_along_axis(d2, part, axis=1).argsort(axis=1)
        out[start:end] = np.take_along_axis(part, order, axis=1)
    return out


def knn_recall(input_knn: np.ndarray, emb: np.ndarray, k: int) -> float:
    emb_knn = exact_knn(emb, k)
    hits = 0
    for i in range(input_knn.shape[0]):
        hits += len(set(input_knn[i, :k].tolist()) & set(emb_knn[i].tolist()))
    return hits / (input_knn.shape[0] * k)


def trustworthiness(x_input: np.ndarray, emb: np.ndarray, k: int, sample: int, seed: int) -> float:
    """Venna & Kaski trustworthiness on a random query sample (exact ranks)."""
    n = x_input.shape[0]
    rng = np.random.default_rng(seed)
    queries = rng.choice(n, size=min(sample, n), replace=False)
    emb_knn = exact_knn(emb, k)  # full, cheap in 2D
    sq_in = (x_input ** 2).sum(axis=1)
    total = 0.0
    for q in queries:
        d2 = sq_in[q] + sq_in - 2.0 * (x_input @ x_input[q])
        d2[q] = np.inf
        # rank_input[j] = 1-based rank of j among q's input-space neighbors
        order = np.argsort(d2)
        ranks = np.empty(n, dtype=np.int64)
        ranks[order] = np.arange(1, n + 1)
        for j in emb_knn[q]:
            r = ranks[j]
            if r > k:
                total += r - k
    m = len(queries)
    norm = 2.0 / (m * k * (2 * n - 3 * k - 1))
    return 1.0 - norm * total


def evaluate(name: str, x_input: np.ndarray, emb: np.ndarray, input_knn: np.ndarray, seconds: float) -> dict:
    metrics = {
        'name': name,
        'seconds': round(seconds, 1),
        'trustworthiness': round(trustworthiness(x_input, emb, TRUST_K, TRUST_SAMPLE, SEED), 4),
    }
    for k in RECALL_KS:
        metrics[f'recall@{k}'] = round(knn_recall(input_knn, emb, k), 4)
    print(metrics)
    return metrics


def main() -> None:
    with open(os.path.join(HERE, 'mammoth_3d.json')) as f:
        x = np.array(json.load(f), dtype=np.float32)
    n = x.shape[0]
    print(f'mammoth: {n} x {x.shape[1]}')

    t0 = time.time()
    input_knn = exact_knn(x, max(RECALL_KS))
    print(f'input kNN in {time.time() - t0:.1f}s')

    results = []

    # PCA-2D baseline (also the JS metric-parity check).
    t0 = time.time()
    centered = x - x.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    pca2 = centered @ vt[:2].T
    results.append(evaluate('PCA-2D', x, pca2, input_knn, time.time() - t0))

    # umap-learn, library defaults for everything not matched to the story.
    import umap
    t0 = time.time()
    reducer = umap.UMAP(n_neighbors=UMAP_N_NEIGHBORS, min_dist=UMAP_MIN_DIST, random_state=SEED)
    emb_umap = reducer.fit_transform(x)
    results.append(evaluate('umap-learn', x, np.asarray(emb_umap), input_knn, time.time() - t0))

    # openTSNE, PCA initialization (matching the GPU kernel's init).
    from openTSNE import TSNE
    t0 = time.time()
    emb_tsne = TSNE(perplexity=TSNE_PERPLEXITY, initialization='pca', random_state=SEED, n_jobs=-1).fit(x)
    results.append(evaluate('openTSNE', x, np.asarray(emb_tsne), input_knn, time.time() - t0))

    payload = {
        'dataset': f'mammoth {n}x{x.shape[1]}',
        'params': {
            'umap': {'n_neighbors': UMAP_N_NEIGHBORS, 'min_dist': UMAP_MIN_DIST},
            'tsne': {'perplexity': TSNE_PERPLEXITY},
            'trust_k': TRUST_K,
            'trust_sample': TRUST_SAMPLE,
            'seed': SEED,
        },
        'results': results,
    }
    with open(os.path.join(HERE, 'benchmark-reference.json'), 'w') as f:
        json.dump(payload, f, indent=1)
    print('wrote benchmark-reference.json')


if __name__ == '__main__':
    main()
