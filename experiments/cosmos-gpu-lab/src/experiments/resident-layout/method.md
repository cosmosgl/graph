```flow
Positions after gravity
CPU bounds · Download positions, find the bounds, upload the bounds | GPU bounds · Find the bounds directly in the GPU position buffer
Continue on the GPU · Build the grid, apply forces, draw points and links
```

WebGPU compute shaders find the smallest and largest coordinates in groups, combine the results,
and write the padded square to a storage buffer the grid reads. Cosmos WebGL uses fragment shaders
to reduce the coordinates and stores the square in a one-texel texture.
[WebGPU dispatch synchronization](https://gpuweb.github.io/gpuweb/#programming-model-synchronization)
