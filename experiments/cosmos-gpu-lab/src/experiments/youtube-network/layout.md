# About the layout

The 262,144-point example keeps the first 262,144 points in the prepared
benchmark dataset and all friendship links between those points.
The 300,000-point example samples 300,000 friendship links across the dataset,
keeping at least one link for every account in the sample.

Both viewers start from the same small square of seeded positions. As they
run, repulsion spreads the points and the friendship links pull connected
points together. Run widens the initial overview once to make room for the
expanding graph. Both viewers then keep the same camera as their layouts
advance independently. Fit returns to the overview.

To compare speed from the seeded layout, use Run WebGL and Run WebGPU in
turn after loading the page. Click the active button to pause.
