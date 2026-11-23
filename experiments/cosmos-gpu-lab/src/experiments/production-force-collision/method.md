**Step collision** advances the same graph application in two frames. Each frame loads one workspace package and checks the device the Graph created. Both receive fresh copies of the same typed arrays, the same random seed, and the same fixed view. Only collision moves the points. **Reset** reconstructs both graphs from tick zero.

The seven-slot scene has four movable neighbors, a pinned point, an isolated point and one absent slot. Circles have different sizes, which determine their collision radii. The constraint uses strength 1, padding 3, zero collision cooling and two iterations per tick. The 4,097-slot case adds an evenly spaced grid outside the view, so the same visible contacts run through the hashed solver.

**Point positions** compares every x and y from `getPointPositionsAsync()`, including offscreen points. An absent point matches when both coordinates are NaN in both packages. The readout counts differing point slots and gives the largest absolute coordinate difference in graph units.

**Rendered pixels** compares the full 256 × 192 drawing at pixel ratio 1. After reading positions, each paused Graph redraws once and the experiment immediately copies its canvas at native resolution. Any changed red, green, blue or alpha byte counts that pixel once. The largest channel difference is on a 0–255 scale. Two blank canvases cannot produce a passing result. A difference at tick zero can reveal a drawing discrepancy before either solver moves a point.

Select **Highlight differing pixels in magenta on WebGPU** to see their locations. The overlay uses a separate canvas so the markings never enter the comparison.

The dedicated [Points comparison](#/production-points) measures the eight point shapes at fractional diameters and pixel ratios 1 and 2.
