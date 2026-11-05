# Correctness validation

Performance is only meaningful after the builder proves these invariants:

1. Every GPU cell count equals the CPU histogram.
2. Every offset equals the CPU exclusive scan.
3. The sentinel equals the total point count.
4. Every scattered index belongs to the cell range containing it.
5. Every input point appears exactly once—no duplicates and no missing indices.

The validation is exhaustive rather than sampled, including the five-million-point preset. It runs
after the timed build:

```text
timed:    GPU count → scan → scatter → queue completion
untimed:  readback → CPU comparison → heatmap
```

## Why order is not compared

Atomic scatter does not define the order in which invocations reserve destinations. Two correct runs
may contain different point ordering inside one cell. Consumers must depend on range membership, not
stable intra-cell order.

## Stress distributions

- **Uniform** checks broad occupancy and typical contention.
- **Eight clusters** produces dense hot cells similar to graph communities.
- **Diagonal** concentrates points into a narrow band and stresses both contention and empty-cell
  handling.

All three must satisfy the same structural invariants.
