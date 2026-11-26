# WebGL selection reference for the isolated Lab study

The rectangle and polygon fragment shaders in this directory reproduce the v3.6.0 selection experiment. The independent CPU and WGSL implementations in `src/experiments/selection` measure that version’s rectangle bounds, half-open polygon edges and 2,048-edge cutoff. The two files come from the v3.6.0 commit `738431aecf20be7a93f6e7692f7dc0acfc8c6fd9`, with trailing whitespace trimmed.

- [Original rectangle shader](https://github.com/cosmosgl/graph/blob/738431aecf20be7a93f6e7692f7dc0acfc8c6fd9/src/modules/Points/find-points-in-rect.frag)
- [Original polygon shader](https://github.com/cosmosgl/graph/blob/738431aecf20be7a93f6e7692f7dc0acfc8c6fd9/src/modules/Points/find-points-in-polygon.frag)

The current package comparison in `src/experiments/production-graph-api/area-selection.test.ts` exercises touch and center selection and a 32,771-vertex polygon through the public Graph API.
