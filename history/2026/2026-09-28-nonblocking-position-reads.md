<!-- suggested path: history/2026/2026-09-28-nonblocking-position-reads.md -->

# Non-blocking position reads (tracked points, cluster centroids), and point trackers

**Commits:** tracked points, PR #273: `perf(points): reuse tracked positions while the simulation runs` (`faccaac`), `perf(points): read tracked positions without blocking` (`1ccecf4`), `docs(points): say that the first non-blocking read still waits` (`fd0f835`); clusters, PR #276: `perf(clusters): reuse the centroid cache while the simulation runs` (`b9888e5`), `perf(clusters): read cluster positions without blocking` (`9a2771a`); review follow-up, same PR: `fix(clusters): drop the up-to-date claim when a centroid readback ends without pixels` (`f430602`), `fix(points): re-issue a tracked readback that ended without pixels` (`1b000a0`); trackers, PR #257: `feat(points): point trackers — follow chosen points through a handle, on a simulation as on a graph` (`58f4afe`)

## Why

Overlays such as labels read positions back from the GPU on every simulation tick:
`getTrackedPointPositionsMap()` for point labels, `getClusterPositions()` for cluster
labels. Both ended in a synchronous `readPixels`, which cannot return before the GPU
has run everything queued ahead of it, in this case the whole tick. In Safari, whose
WebGL runs in a separate GPU process, that wait is an IPC round trip on top of the
drain, which is where the report of slow cluster labels came from.

Two things were wrong, and each reader had both:

- **The CPU cache was gated on the simulation being stopped.** While it ran, every
  call read the GPU again, even a second call in the same frame (labels on tick and
  again on zoom). The cache flag is already cleared by every writer of the position
  texture, so the gate was redundant: the cache is valid exactly while the flag
  holds. Without the gate, N reads per position change cost one readback instead
  of N.
- **One read per tick still stalled for the tick.** The first read after a position
  change has to go to the GPU, and a synchronous read parks the main thread for as
  long as the tick's GPU work takes. The frame loses the CPU-GPU overlap: the GPU
  sits idle while the result transfers and while the CPU does its work between the
  read and the draw, a fraction of a GPU-bound frame. The main thread loses the
  whole wait, which nothing else on the page can use while the call blocks.

Embedding added a third. The scheme below was built on `Graph`'s render frames, and
tracking was one set behind three `Graph` methods. A standalone `GraphSimulation`,
which is what a deck.gl layer draws, has no frames and had no tracking at all; a
headless `Graph` and one with `enableRenderLoop: false` had the methods but no frame
to feed them, so a non-blocking read stayed at its first result.

## The scheme

Both methods take `{ nonBlocking: true }` (one exported type, `PositionsReadOptions`;
the tracked-only name it replaced was never published):

```js
// labels overlay, every tick
graph.getClusterPositions({ nonBlocking: true })
graph.getTrackedPointPositionsMap({ nonBlocking: true })

// the same on a standalone simulation
const tracker = simulation.trackPoints(indices)
tracker.positions({ nonBlocking: true })
simulation.getClusterPositions({ nonBlocking: true })
```

A non-blocking read returns the latest positions the GPU has already handed back, a
frame or more behind the drawn points, and notes that a readback is wanted. The frame
end issues the readback into a `PIXEL_PACK_BUFFER` behind a fence (the
`PickingReadback` helper from [picking](2026-07-09-picking.md)); the next frame's
start collects it, before the frame queues GPU work, so `getBufferSubData` has
nothing to wait behind.

Where no frame will come, the read does both jobs: it collects a copy that has landed
and issues the next one. The frame end stays the first choice because it follows the
frame's last position write, so the copy holds the newest positions; a read is the
fallback because it is the only event a host without frames is sure to produce.
`Graph` tells the points module which case it is in: asked for a tick, it requests a
render and answers yes, or answers no when it is headless or has no render loop of
its own. A standalone simulation has nobody to ask, which reads as no.

What this buys: the GPU work is unchanged (the gather pass runs once per frame in
which positions changed, which is what a blocking caller reading every tick pays
once the cache is trusted), so the frame gets back the overlap the stall threw away
and the main thread gets back the whole wait, since the call now costs a map or
array lookup. The price is one frame of lag, which an overlay cannot show at the
speeds points move between ticks.

- Readbacks are issued only while non-blocking reads are being taken and only after
  a position change, so they stop when the reads do or the layout settles.
- `shouldKeepRendering()` stays true while one is in flight: the copy issued after
  the simulation's last step is still collected, so an overlay ends on the settled
  layout and the loop then idles. Same class of gap as the picking rebase fix.
- The first read, and the first after the tracked set or the clusters change, still
  blocks: there is nothing earlier to return.
- A non-blocking read taken outside a frame (a timer, a button) requests one; an idle
  loop would never issue the readback it needs. Where no frame can be promised, the
  read issues the copy itself.
- A blocking read while a copy is in flight cancels it and reads synchronously: the
  copy holds older positions than the read about to be taken.

## Trackers

Tracking is a handle the simulation gives out:

```js
const tracker = simulation.trackPoints([0, 5, 9])
tracker.positions({ nonBlocking: true }) // ReadonlyMap<index, [x, y]>
tracker.positionsArray()                 // [x0, y0, x1, y1, …], NaN for a point that is gone
tracker.setIndices([2, 3])
tracker.destroy()
```

- **A handle, not three more methods.** One set per engine made the parts of an
  application overwrite each other's points. A tracker owns its set, its GPU target,
  its cache and its copy in flight, so trackers are independent and each has a
  lifetime its owner ends. It may be created before data arrives and before the
  device is ready.
- **`Graph`'s three tracking methods are unchanged** and run on one internal tracker.
  The released surface stays as it was; `Graph` has no `trackPoints` of its own yet.
- **Versions instead of flags.** The points module counts every write to the position
  texture. The cache, the gathered target and the copy issued last each remember the
  version they hold, so "behind" is a comparison and not a flag every writer has to
  clear for every reader. With several trackers the flags would have been per set;
  the version is one number they all read. It also lets a tracker skip its gather
  while its target is current, which the frames of a paused simulation used to redo.
- **Draws between steps reset the host's GL state.** A tracker gathers when it is
  created, given another set, or read while behind, and a cluster read sums positions
  in a pass of its own. On a shared device those draws inherit what the host left: a
  scissor or a color mask silently dropped them. Both now reset the state first, as a
  simulation step does (see [host embedding](2026-08-18-host-embedding.md)).

## Which points exist

A non-blocking read may be behind on coordinates. It must not be behind on which
points exist, and two different moments used to be stored as one cache entry: the
coordinates came from a copy taken earlier, the membership check ran when that copy
was decoded. A point list that changed in between gave three wrong answers:

| the point | what a non-blocking read reported |
|---|---|
| was removed | still in the map, until the copy in flight landed |
| appeared (the count grew) | at the zeros its index had gathered while it was out of range |
| was revived (absent, then present) | at `NaN`, the position it had while absent |

The points module keeps a point-list version. It goes up when the count or the set of
absent points really changes, found by the absence scan every data apply already
runs, and when the last point is removed. New coordinates for the same points leave
it alone. The cache and the copy in flight each remember the version they were taken
under:

- An older cache drops the points that are gone before it is returned. It keeps its
  old position version, so a blocking read still goes to the GPU and reports a point
  that is already there.
- An older copy is discarded, not decoded, and another is asked for. Trimming the
  cache cannot undo a decode that has inserted a point at the wrong place.

So a removed point leaves the map at once, and a point that appeared or revived joins
it when a copy taken under the current list lands.

Two shortcuts were rejected. A flag written by the gather shader for an out-of-range
fetch misses the revived point, whose index is in range, and an index past the count
can still land on a padding texel inside the texture. Raising the version on every
data apply would be simpler than comparing, but an application that sends its own
layout every frame would then discard every copy and never see a new position.

Cluster reads have no such gap: `Clusters.create()` runs on every data apply and
drops both the cached centroids and the copy in flight, so the first read after it
waits and is current. The price is that an application re-sending data every frame
gets no benefit from `nonBlocking` on cluster reads.

## Clusters

The centroid path had more to fix than the tracked one:

- **Every read ran the centermass pass again**, on top of the one the tick's
  `Clusters.run()` already ran. The non-blocking design keeps one pass per frame,
  at frame end, summing the positions the frame drew. Reusing the tick's own
  mid-step sums instead would have saved that pass, at the price of centroids one
  or two force passes behind the drawn points; the pass is a point-list draw whose
  cost is one texel fetch per point, and it did not register against the frame, so
  the exact pass was kept.
- **The on-demand pass summed the wrong texture.** It bound `previousPositionTexture`,
  which inside a step is the freshest (the swap has just made it so, and `run()`
  still uses it), but by the time a tick callback runs it is one force pass behind
  `currentPositionTexture`. On-demand and frame-end passes now sum `current`.
- **One flag channel from Points.** `Points.areClusterCentroidsUpToDate` is the only
  signal Points sends Clusters about position writes, so rather than mirror the two
  flags the tracked path kept at the time (versions now, see Trackers), it holds
  while the cached array, or a copy
  still in flight, matches the positions: a blocking read sets it after filling the
  array, an issued readback sets it while the array is still the previous one. The
  pending copy stands in for "the array has been filled":

  | state | blocking read | `nonBlocking` read |
  |---|---|---|
  | flag holds, cache present, nothing in flight | cache | cache |
  | positions changed, cache present | pass + `readPixels`, flag set | cache; readback wanted |
  | copy in flight, flag holds | cancels it, pass + `readPixels` | cache; wanted |
  | no cache yet | pass + `readPixels` | pass + `readPixels` (blocks) |

- `Clusters.create()` drops a copy in flight: the centermass FBO may be reallocated
  when the cluster count changes, and the readback buffer is sized to it.

## A read that ends without pixels

Review found the one place the single flag lied. `poll()` ends a read without pixels
when the fence wait fails (`WAIT_FAILED`, or the `0` a lost context returns); it
clears its in-flight state, the resolve wrote nothing, and the flag set at issue
time still said the cached array was current. Every later read took the cache: a
blocking `getClusterPositions()` returned stale centroids, a non-blocking one never
asked again, and after the simulation's last step nothing clears the flag, so labels
stayed a tick behind the settled layout for the rest of the session. The tracked
path had the milder half: its cache flag is set only by blocking reads, but the
stale flag was not set back either, so a non-blocking read waited for a position
write that never comes.

Fix: a read that ends without pixels clears the cluster flag / makes the tracker
forget the version it issued, so the next read recomputes or asks again. Both resolves check
`inFlight` before polling; an idle frame's poll returns nothing too, and a blocking
read that already cancelled the copy has just filled the cache, so neither may
touch the flags. Verified by forcing `clientWaitSync` to report `WAIT_FAILED` on the
copy issued after the last step and checking the next reads against centroids
computed on the CPU.

## Example

`integrations/deck-layers/src/stories/graph-layer.ts`, Storybook → Examples →
Integrations → Graph layer. The hub labels are a `TextLayer` fed by a tracker: a
non-blocking read on every tick, a plain read when the simulation pauses or ends so
the labels rest exactly on the hubs, and `setIndices` when a cluster is added or
removed.

## Notes

- One readback slot per reader. Where the browser observes fences late (headless
  Chrome: two frames), a new copy cannot be issued while the previous one is out,
  so the result alternates two and three ticks behind instead of one. Fine for
  labels; a second slot would fix it if a reader ever needs the latency.
- `positionsArray()` returns a plain array, as `getTrackedPointPositionsArray()` always
  has, so the graph method hands it on without a copy. A `Float32Array` destination,
  which deck.gl takes as a binary attribute, is left for later.
