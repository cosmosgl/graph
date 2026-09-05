/**
 * deck.gl layers that render a cosmos.gl simulation with **zero position
 * readback**: each draw samples the live GPU position texture exposed by
 * `graph.getPointPositionTexture()` with `texelFetch`, so point coordinates
 * never leave the GPU. The layers share deck.gl's device with the cosmos.gl
 * simulation, which the application owns and steps.
 *
 * The layers draw with plain WebGL uniforms and the viewport's view-projection
 * matrix, so deck.gl's pan/zoom applies without involving deck.gl's shader
 * modules. luma.gl keeps the `uniforms` record handed to a `Model` by reference
 * and re-reads it on every draw, so each layer keeps that same record in its
 * state and mutates it in place.
 */
export { CosmosPointsLayer, type CosmosPointsLayerProps } from './cosmos-points-layer'
export { CosmosLinksLayer, type CosmosLinksLayerProps } from './cosmos-links-layer'
