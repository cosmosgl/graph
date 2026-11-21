---
source: Recorded findings
recorded: 2026-11-16
device: Native Apple WebGPU adapter, Metal 3, Chromium 157; exact chip not exposed
scope: Six frozen workloads repeated twice and a separate 64-case preservation check
---

# Compute-cache evidence

Rebuilding a curve-sample cache did not clear the cost screening gate on any
of the recorded workloads. Reusing a static cache gave inconsistent savings
and required additional memory; the investigation stopped without adoption.

The focused preservation check kept every color and ID byte in **64 of 64**
curve configurations. A larger fixture exposed a counterexample: **10,000 short
curves at three segments changed two color pixels** in both repetitions, with
no ID changes. The change failed the exact-preservation gate and its arithmetic
cause was not established.

The timing observations are isolated GPU or batch-completion measurements on
one adapter, not complete-frame responsiveness or a general performance claim.
