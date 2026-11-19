---
source: Recorded findings
recorded: 2026-11-16
device: Apple M3 with inline Chromium 157; Linux x64 SwiftShader with Chromium 151
scope: Bounded alpha-boundary and overlap picking checks
---

# Point-picking evidence

The stored-alpha prototype keeps the color pass unchanged. For each point it
uses that point's stored paint alpha and geometric picking mask to decide whether
the point may claim an ID. A transparent foreground therefore cannot intercept
the visible point behind it. The CPU composition check reads isolated masks and
resolves their order; it does not independently predict framebuffer rounding.

| Recorded check | Apple M3 | Linux SwiftShader |
| --- | --- | --- |
| Candidate and UI/export tests | 5/5 pass | 5/5 pass |
| Candidate plus retained controls | 21/21 pass | 19 pass; 2 retained control failures |
| Tested candidate color changes / invisible picks | 0 / 0 | 0 / 0 |

The inputs covered selected opacity boundaries, overlaps, normal and reversed
order, transparent images, and pixel ratios 1 and 2. The two Linux failures are
retained for the earlier mathematical source-byte control; the prototype does not
turn those failures into passes.

This is a bounded correctness prototype, not a scalable production picking
implementation. It supports regions up to 64 × 64 pixels and at most 1,024
points, with multiple passes per point. The checks do not establish production
hover latency, all-image behavior or compatibility on other devices.
