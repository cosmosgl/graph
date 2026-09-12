#version 300 es
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D imageAtlasTexture;

#ifdef USE_UNIFORM_BUFFERS
layout(std140) uniform drawFragmentUniforms {
  float greyoutOpacity;
  float pointOpacity;
  float isDarkenGreyout;
  vec4 backgroundColor;
  vec4 outlineColor;
  float outlineWidth;
  float renderMode;
} drawFragment;

#define greyoutOpacity drawFragment.greyoutOpacity
#define pointOpacity drawFragment.pointOpacity
#define isDarkenGreyout drawFragment.isDarkenGreyout
#define backgroundColor drawFragment.backgroundColor
#define outlineColor drawFragment.outlineColor
#define outlineWidth drawFragment.outlineWidth
#define renderMode drawFragment.renderMode
#else
uniform float greyoutOpacity;
uniform float pointOpacity;
uniform float isDarkenGreyout;
uniform vec4 backgroundColor;
uniform vec4 outlineColor;
uniform float outlineWidth;
uniform float renderMode;
#endif


in float pointShape;
in float isGreyedOut;
in float isOutlined;
in vec4 shapeColor;
in vec4 imageAtlasUV;
in float shapeSize;
in float imageSizeVarying;
in float overallSize;

out vec4 fragColor;

// Occlusion culling splits fragments between the opaque core pass (renderMode 1)
// and the blended fringe pass (renderMode 2) at this final-alpha threshold
const float OPAQUE_ALPHA_THRESHOLD = 0.999;

// Shape constants
const float CIRCLE = 0.0;
const float SQUARE = 1.0;
const float TRIANGLE = 2.0;
const float DIAMOND = 3.0;
const float PENTAGON = 4.0;
const float HEXAGON = 5.0;
const float STAR = 6.0;
const float CROSS = 7.0;
const float NONE = 8.0;

// Distance functions for different shapes
float circleDistance(vec2 p) {
    return dot(p, p);
}

// Function to apply greyout logic to image colors
vec4 applyGreyoutToImage(vec4 imageColor, float isGreyedOutValue) {
    vec3 finalColor = imageColor.rgb;
    float finalAlpha = imageColor.a;
    
    if (isGreyedOutValue > 0.0) {
        float blendFactor = 0.65; // Controls how much to modify (0.0 = original, 1.0 = target color)
        
        if (isDarkenGreyout > 0.0) {
            finalColor = mix(finalColor, vec3(0.2), blendFactor);
        } else {
            finalColor = mix(finalColor, max(backgroundColor.rgb, vec3(0.8)), blendFactor);
        }
    }
    
    return vec4(finalColor, finalAlpha);
}

float squareDistance(vec2 p) {
    vec2 d = abs(p) - vec2(0.8);
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float triangleDistance(vec2 p) {
    const float k = sqrt(3.0);   // ≈1.732; slope of 60° lines for an equilateral triangle
    const float r = 0.9;         // half the edge length; each edge is 2r
    p.x = abs(p.x) - r;          // fold the X axis and shift: the base corner is at the origin
    p.y += 0.55;                 // move the base (y = -0.55 in the core) to y = 0. The centred offset is
                                 // r/k = 0.52; 0.55 keeps the apex at 1.01 rather than 1.04

    // Reflect across the corner's bisector: the slanted edge maps onto the x axis,
    // corner at x = 0, apex at x = -2r
    if (p.x + k * p.y > 0.0)
        p = vec2(p.x - k * p.y,  -k * p.x - p.y) / 2.0;

    // Distance to the edge as the segment [-2r, 0] on the x axis
    p.x -= clamp(p.x, -2.0 * r, 0.0);

    // Return signed distance: negative = inside; positive = outside
    return -length(p) * sign(p.y);
}

float diamondDistance(vec2 p) {
    // aspect > 1  →  taller diamond
    const float aspect = 1.2;
    return abs(p.x) + abs(p.y) / aspect - 0.8;
}

float pentagonDistance(vec2 p) {
    // Regular pentagon signed-distance (Inigo Quilez)
    const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528); // cos 36°, sin 36°, tan 36°
    const float r = 0.726542528;                                // apothem: the flat edge is at y = r; equal to k.z by
                                                                // coincidence of the chosen size, not by construction
    p.x = abs(p.x);

    // Reflect across the two tilted edges ─ only if point is outside
    p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
    p -= 2.0 * min(dot(vec2( k.x, k.y), p), 0.0) * vec2( k.x, k.y);

    // distance to the flat edge as a segment: every corner folds onto x = ±r·tan 36°
    p -= vec2(clamp(p.x, -r * k.z, r * k.z), r);

    // Return signed distance (negative → inside, positive → outside)
    return length(p) * sign(p.y);
}

float hexagonDistance(vec2 p) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * 0.8, k.z * 0.8), 0.8);
    return length(p) * sign(p.y);
}

float starDistance(vec2 p) {
    // 5-point star signed-distance function (adapted from Inigo Quilez)
    // r  – outer radius, rf – inner/outer radius ratio
    const float r  = 0.9;
    const float rf = 0.45;

    // Pre-computed rotation vectors for the star arms (36° increments)
    const vec2 k1 = vec2(0.809016994, -0.587785252);
    const vec2 k2 = vec2(-k1.x, k1.y);

    // Fold the plane into a single arm sector
    p.x = abs(p.x);
    p -= 2.0 * max(dot(k1, p), 0.0) * k1;
    p -= 2.0 * max(dot(k2, p), 0.0) * k2;
    p.x = abs(p.x);

    // Translate so the top tip of the star lies on the X-axis
    p.y -= r;

    // Vector describing the edge between an outer tip and its adjacent inner point
    vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    // Project the point onto that edge and clamp the projection to the segment
    float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);

    // Return signed distance (negative => inside, positive => outside)
    return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

float crossDistance(vec2 p) {
    // Signed distance function for a cross (union of two rectangles)
    // Adapted from Inigo Quilez (https://iquilezles.org/)
    // Each arm has half-sizes 0.3 (thickness) and 0.8 (length)
    p = abs(p);
    if (p.y > p.x) p = p.yx;       // exploit symmetry

    vec2 q = p - vec2(0.8, 0.3);   // subtract half-sizes (length, thickness)

    // Standard rectangle SDF, then take union of the two arms
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float getShapeDistance(vec2 p, float shape) {
    if (shape == SQUARE) return squareDistance(p);
    else if (shape == TRIANGLE) return triangleDistance(p);
    else if (shape == DIAMOND) return diamondDistance(p);
    else if (shape == PENTAGON) return pentagonDistance(p);
    else if (shape == HEXAGON) return hexagonDistance(p);
    else if (shape == STAR) return starDistance(p);
    else if (shape == CROSS) return crossDistance(p);
    else return circleDistance(p); // Default to circle
}

void main() {
    // Discard the fragment if the point is fully transparent and has no image
    if (shapeColor.a == 0.0 && imageAtlasUV.x == -1.0) {
        discard;
    }

    // Discard the fragment if the point has no shape and no image
    if (pointShape == NONE && imageAtlasUV.x == -1.0) {
        discard;
    }

    // Calculate coordinates within the point
    vec2 pointCoord = 2.0 * gl_PointCoord - 1.0;

    // pointCoord covers the full sprite, which is larger than the shape when the point is
    // outlined, carries a bigger image, or is under a pixel. Rescale it so the shape keeps
    // its intended size.
    vec2 shapeCoord = pointCoord;
    float shapeDiameterPx = overallSize;
    if (overallSize > shapeSize && shapeSize > 0.0) {
        shapeCoord = pointCoord * (overallSize / shapeSize);
        shapeDiameterPx = shapeSize;
    }

    vec4 finalShapeColor = vec4(0.0);
    vec4 finalImageColor = vec4(0.0);
    
    // Ramp of EDGE_RAMP_PX device pixels centred on the shape edge. The sprite is the shape's own
    // size: the outer half of the ramp is clipped only where the shape touches the sprite's sides.
    // A shape under one device pixel is drawn as a one-pixel core with alpha shape² / core², the
    // ink of its true area; a size of 0 has no shape.
    if (pointShape != NONE && shapeSize > 0.0) {
        float coreDiameterPx = max(shapeDiameterPx, 1.0);
        float smallAlpha = min(1.0, (shapeDiameterPx * shapeDiameterPx) / (coreDiameterPx * coreDiameterPx));
        vec2 coreCoord = shapeCoord * (shapeDiameterPx / coreDiameterPx); // -1..1 across the core
        float halfRampPx = EDGE_RAMP_PX * 0.5;

        float opacity;
        if (pointShape == CIRCLE) {
            // Along the radius: a ramp in r² skews coverage outward on small discs.
            float rPx = length(coreCoord) * coreDiameterPx * 0.5;
            opacity = 1.0 - smoothstep(coreDiameterPx * 0.5 - halfRampPx, coreDiameterPx * 0.5 + halfRampPx, rPx);
        } else {
            float shapeDistance = getShapeDistance(coreCoord, pointShape);
            // Half a ramp in field units, via the field's gradient per pixel: exact for a field that
            // is linear across the ramp, as every polygon field is at its edge. All fragments of a
            // sprite share pointShape, so the derivative is taken in coherent control flow.
            float shapeHalfRamp = max(halfRampPx * length(vec2(dFdx(shapeDistance), dFdy(shapeDistance))), 1e-6);
            opacity = 1.0 - smoothstep(-shapeHalfRamp, shapeHalfRamp, shapeDistance);
        }
        opacity *= smallAlpha * shapeColor.a;

        finalShapeColor = vec4(shapeColor.rgb, opacity);
    }

    // Handle image rendering with centering logic
    if (imageAtlasUV.x != -1.0) {
        // Calculate image coordinates with centering
        vec2 imageCoord = pointCoord;
        if (overallSize > imageSizeVarying && imageSizeVarying > 0.0) {
            // Image is smaller than overall size, center it
            float scale = imageSizeVarying / overallSize;
            imageCoord = pointCoord / scale;
            
            // Check if we're outside the valid image area
            if (abs(imageCoord.x) > 1.0 || abs(imageCoord.y) > 1.0) {
                // We're outside the image bounds, don't render the image
                finalImageColor = vec4(0.0);
            } else {
                // Sample from texture atlas
                vec2 atlasUV = mix(imageAtlasUV.xy, imageAtlasUV.zw, (imageCoord + 1.0) * 0.5);
                vec4 imageColor = texture(imageAtlasTexture, atlasUV);
                finalImageColor = applyGreyoutToImage(imageColor, isGreyedOut);
            }
        } else {
            // Image is same size or larger than overall size, no scaling needed
            // Sample from texture atlas
            vec2 atlasUV = mix(imageAtlasUV.xy, imageAtlasUV.zw, (imageCoord + 1.0) * 0.5);
            vec4 imageColor = texture(imageAtlasTexture, atlasUV);
            finalImageColor = applyGreyoutToImage(imageColor, isGreyedOut);
        }
    }

    float finalPointAlpha = max(finalShapeColor.a, finalImageColor.a);
    if (isGreyedOut > 0.0 && greyoutOpacity != -1.0) {
        finalPointAlpha *= greyoutOpacity;
    } else {
        finalPointAlpha *= pointOpacity;
    }

    // Blend image color above point color
    fragColor = vec4(
        mix(finalShapeColor.rgb, finalImageColor.rgb, finalImageColor.a),
        finalPointAlpha
    );

    // Outline ring: band [outlineWidth × R, R], R = POINT_RING_SCALE × point radius, device px.
    // Core at least a ramp wide, centred on the band, ramp centred on both edges. A ring is an
    // interface mark: thinner than the ramp it is widened at full alpha, not dimmed.
    //
    //          inner R      outer R
    //   ────────░░┤░░████████░░├░░────────
    //            fade  core   fade
    if (isOutlined > 0.0) {
        // Sized from the drawn core (a shape under a pixel is drawn as one), inside the sprite,
        // which the hardware cap can clamp: the ring then tightens onto the body.
        float ringOuterPx = min(POINT_RING_SCALE * max(max(shapeSize, 1.0), imageSizeVarying), overallSize - EDGE_RAMP_PX) * 0.5;
        float ringInnerPx = outlineWidth * ringOuterPx;
        float ringCentrePx = (ringOuterPx + ringInnerPx) * 0.5;
        float ringHalfCorePx = max(ringOuterPx - ringInnerPx, EDGE_RAMP_PX) * 0.5;
        float rPx = length(pointCoord) * overallSize * 0.5;
        float ringAlpha = 1.0 - smoothstep(-EDGE_RAMP_PX * 0.5, EDGE_RAMP_PX * 0.5, abs(rPx - ringCentrePx) - ringHalfCorePx);

        // Grey out the ring color when the point is greyed
        vec3 ringColor = outlineColor.rgb;
        if (isGreyedOut > 0.0) {
            float blendFactor = 0.65;
            if (isDarkenGreyout > 0.0) {
                ringColor = mix(ringColor, vec3(0.2), blendFactor);
            } else {
                ringColor = mix(ringColor, max(backgroundColor.rgb, vec3(0.8)), blendFactor);
            }
        }

        float ringOpacity = ringAlpha * outlineColor.a;
        // Source-over of the ring onto the fragment. A plain mix would tint the ring with a
        // transparent body's colour, and the blend would then apply the ring's alpha twice.
        float outAlpha = ringOpacity + fragColor.a * (1.0 - ringOpacity);
        vec3 outRgb = outAlpha > 0.0
            ? (ringColor * ringOpacity + fragColor.rgb * fragColor.a * (1.0 - ringOpacity)) / outAlpha
            : fragColor.rgb;
        fragColor = vec4(outRgb, outAlpha);
    }

    // Occlusion culling: split every fragment between the opaque core pass
    // (depth-writing, unblended) and the blended fringe pass. The same
    // final-alpha rule runs in both passes so each fragment renders exactly once.
    if (renderMode > 1.5) {
        if (fragColor.a >= OPAQUE_ALPHA_THRESHOLD) discard; // already drawn by core pass
    } else if (renderMode > 0.5) {
        if (fragColor.a < OPAQUE_ALPHA_THRESHOLD) discard;  // left for fringe pass
    }
}
