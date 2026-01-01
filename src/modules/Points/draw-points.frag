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
} drawFragment;

#define greyoutOpacity drawFragment.greyoutOpacity
#define pointOpacity drawFragment.pointOpacity
#define isDarkenGreyout drawFragment.isDarkenGreyout
#define backgroundColor drawFragment.backgroundColor
#else
uniform float greyoutOpacity;
uniform float pointOpacity;
uniform float isDarkenGreyout;
uniform vec4 backgroundColor;
#endif


in float pointShape;
in float isGreyedOut;
in vec4 shapeColor;
in vec4 imageAtlasUV;
in float shapeSize;
in float imageSizeVarying;
in float overallSize;

out vec4 fragColor;

// Smoothing controls the smoothness of the point's edge
const float smoothing = 0.9;

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
    p.x = abs(p.x) - 0.9;        // fold the X axis and shift: brings left and right halves together
    p.y = p.y + 0.55;             // move the whole shape up slightly so it is centred vertically

    // reflect points that fall outside the main triangle back inside, to reuse the same maths
    if (p.x + k * p.y > 0.0)
        p = vec2(p.x - k * p.y,  -k * p.x - p.y) / 2.0;

    p.x -= clamp(p.x, -1.0, 0.0); // clip any remainder on the left side

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
    const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
    p.x = abs(p.x);

    // Reflect across the two tilted edges ─ only if point is outside
    p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
    p -= 2.0 * min(dot(vec2( k.x, k.y), p), 0.0) * vec2( k.x, k.y);

    // Clip against the top horizontal edge (keeps top point sharp)
    p -= vec2(clamp(p.x, -k.z * k.x, k.z * k.x), k.z);

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

    vec4 finalShapeColor = vec4(0.0);
    vec4 finalImageColor = vec4(0.0);
    
    // Handle shape rendering with centering logic
    if (pointShape != NONE) {
        // Calculate shape coordinates with centering
        vec2 shapeCoord = pointCoord;
        if (overallSize > shapeSize && shapeSize > 0.0) {
            // Shape is smaller than overall size, center it
            float scale = shapeSize / overallSize;
            shapeCoord = pointCoord / scale;
        }
        
        float opacity;
        if (pointShape == CIRCLE) {
            // For circles, use the original distance calculation
            float pointCenterDistance = dot(shapeCoord, shapeCoord);
            opacity = 1.0 - smoothstep(smoothing, 1.0, pointCenterDistance);
        } else {
            // For other shapes, use the shape distance function
            float shapeDistance = getShapeDistance(shapeCoord, pointShape);
            opacity = 1.0 - smoothstep(-0.01, 0.01, shapeDistance);
        }
        opacity *= shapeColor.a;

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
}
