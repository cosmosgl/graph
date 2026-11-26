# Results

The CPU sums the initial positions to get a reference center. After one GPU rotation, the check
compares the new center with the same rotation applied to the reference. Both sizes returned
the exact point count at both steps.
The allowed center error was 1.19 × 10⁻⁷ clip-space units.

| Points | Center error at initialization | Center error after one rotation |
| ---: | ---: | ---: |
| 65,537 | 1.49 × 10⁻⁹ | 7.57 × 10⁻¹⁰ |
| 10,000,000 | 7.45 × 10⁻¹⁰ | 6.56 × 10⁻¹⁰ |

At 65,537 points, the first pass produces 257 partial sums. The next two passes combine them
into two sums and then one. The final partial in the first pass contains just one point.

An earlier run averaged 0.67 ms per reduction at one million points and 2.62 ms at ten million.
Both measurements may include previously queued work. The cost inside a complete layout,
accuracy over many ticks, and results on other adapters remain open.
