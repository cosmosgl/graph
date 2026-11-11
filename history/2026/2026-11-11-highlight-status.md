# Reusable highlight status

Large selections repeatedly rebuilt point membership Sets and point/link
status upload arrays. Their allocation and collection added CPU work to
highlight and outline interactions even when graph capacity stayed fixed.

Retain the float upload arrays for both renderers and read point membership
from the existing greyout and outline channels when reporting hover flags.
The point Sets only served those callback flags; replacing them with byte
masks would duplicate state already available in the retained upload array.
No separate membership structure or selection-building pass is needed.

Bound membership queries by the current point count so shrinking a graph
cannot expose retained padding. Refresh status when data or configuration
changes, preserve the distinct meanings of empty and undefined selections,
and release the arrays during renderer destruction. Retain point staging data
only while highlighting or outlining is configured; when both are cleared,
upload neutral flags before dropping the CPU reference. Release link staging
data when link highlighting is cleared or points/links are absent, and drop both
caches on the empty-graph render path. Empty selection arrays remain active
configurations. Restoring a selection rebuilds staging data on demand.
Fresh typed arrays are already zeroed, so only reused arrays are cleared;
this avoids a second full-buffer write on allocation paths.

This avoids keeping large inactive CPU caches, at the cost of allocating again
after a clear/restore cycle. GPU texture lifetime and full-upload cost do not
change. Regression checks cover invalid indices, shrink/regrow, array reuse,
clearing one or both point modes, empty graphs, restore and hover callbacks.
The CPU hover lookup adds no GPU readback and does not change picking passes.
