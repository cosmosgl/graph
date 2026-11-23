# Recorded curve checks

With **Drawn faces** on Apple M3, **28 of 64 solid curve cases passed**. A pass required the two renderers and the CPU calculation to agree on the picked link at every pixel, with colors within 2/255. Drawn-face picking preserved the original colors and never picked an invisible source in all 64 cases. Of the 56 cases with nonzero opacity, 20 passed every check. All eight fully transparent cases passed. The wider Cosmos target passed only those eight under the old check, which counted picks outside the painted curve as failures. The pilot allows that extra click area. The automated tests on this page check that rule on separate frozen fixtures.

## Folded ribbon

On the zoomed-out wide bend, picking both faces selected the curve at 69 pixels where it painted nothing in each renderer. Picking only the drawn faces removed all 69 invisible picks.

## Default bow

At pixel (352, 85) with **Drawn faces**, WebGL picked background and WebGPU picked link 1 in both edge modes. The edge setting changed what each renderer painted there.

| Edges | WebGL color (RGBA8) | WebGPU color (RGBA8) |
| --- | --- | --- |
| Antialiased | (76, 54, 31, 89) | (76, 54, 31, 89) |
| Hard | (0, 0, 0, 0), transparent | (217, 153, 89, 255), opaque |

## Archived styles

Endpoint gradients passed 28 of 64 strict cases. A separate check of faint foreground links passed all 72 cases. Dashed and dotted curves passed 4 of 24 cases, all at zero opacity. These results cover frozen curves on one GPU.
