#version 300 es
precision highp float;
precision highp int;

#define kLogBandTextureWidth 12

in vec2 vTexcoord;
in vec4 vColor;
flat in vec4 vBanding;
flat in ivec4 vGlyph;

uniform sampler2D uCurveTexture;
uniform sampler2D uBandTexture;

out vec4 fragColor;

vec4 curveLoad(ivec2 loc) {
    return texelFetch(uCurveTexture, loc, 0);
}

uvec4 bandLoad(ivec2 loc) {
    vec4 raw = texelFetch(uBandTexture, loc, 0);
    return uvec4(floatBitsToUint(raw.x), floatBitsToUint(raw.y), floatBitsToUint(raw.z), floatBitsToUint(raw.w));
}

uint calcRootCode(float y1, float y2, float y3) {
    uint i1 = floatBitsToUint(y1) >> 31u;
    uint i2 = floatBitsToUint(y2) >> 30u;
    uint i3 = floatBitsToUint(y3) >> 29u;

    uint shift = (i2 & 2u) | (i1 & ~2u);
    shift = (i3 & 4u) | (shift & ~4u);

    return (0x2E74u >> shift) & 0x0101u;
}

vec2 solveHorizPoly(vec4 p12, vec2 p3) {
    vec2 a = p12.xy - p12.zw * 2.0 + p3;
    vec2 b = p12.xy - p12.zw;
    float ra = 1.0 / a.y;
    float rb = 0.5 / b.y;

    float d = sqrt(max(b.y * b.y - a.y * p12.y, 0.0));
    float t1 = (b.y - d) * ra;
    float t2 = (b.y + d) * ra;

    if (abs(a.y) < 1.0) {
        t1 = p12.y * rb;
        t2 = t1;
    }

    return vec2(
        (a.x * t1 - b.x * 2.0) * t1 + p12.x,
        (a.x * t2 - b.x * 2.0) * t2 + p12.x
    );
}

vec2 solveVertPoly(vec4 p12, vec2 p3) {
    vec2 a = p12.xy - p12.zw * 2.0 + p3;
    vec2 b = p12.xy - p12.zw;
    float ra = 1.0 / a.x;
    float rb = 0.5 / b.x;

    float d = sqrt(max(b.x * b.x - a.x * p12.x, 0.0));
    float t1 = (b.x - d) * ra;
    float t2 = (b.x + d) * ra;

    if (abs(a.x) < 1.0) {
        t1 = p12.x * rb;
        t2 = t1;
    }

    return vec2(
        (a.y * t1 - b.y * 2.0) * t1 + p12.y,
        (a.y * t2 - b.y * 2.0) * t2 + p12.y
    );
}

ivec2 calcBandLoc(ivec2 glyphLoc, uint offset) {
    ivec2 bandLoc = ivec2(glyphLoc.x + int(offset), glyphLoc.y);
    bandLoc.y += bandLoc.x >> kLogBandTextureWidth;
    bandLoc.x &= (1 << kLogBandTextureWidth) - 1;
    return bandLoc;
}

float calcCoverage(float xcov, float ycov, float xwgt, float ywgt) {
    float coverage = max(
        abs(xcov * xwgt + ycov * ywgt) / max(xwgt + ywgt, 1.0 / 65536.0),
        min(abs(xcov), abs(ycov))
    );
    return clamp(coverage, 0.0, 1.0);
}

float slugRender(vec2 renderCoord, vec4 bandTransform, ivec4 glyphData) {
    int curveIndex;

    vec2 emsPerPixel = fwidth(renderCoord);
    vec2 pixelsPerEm = 1.0 / emsPerPixel;

    ivec2 bandMax = glyphData.zw;
    bandMax.y &= 0x00FF;

    ivec2 bandIndex = clamp(
        ivec2(renderCoord * bandTransform.xy + bandTransform.zw),
        ivec2(0, 0),
        bandMax
    );
    ivec2 glyphLoc = glyphData.xy;

    float xcov = 0.0;
    float xwgt = 0.0;

    uvec2 hbandData = bandLoad(ivec2(glyphLoc.x + bandIndex.y, glyphLoc.y)).xy;
    ivec2 hbandLoc = calcBandLoc(glyphLoc, hbandData.y);

    for (curveIndex = 0; curveIndex < int(hbandData.x); curveIndex++) {
        ivec2 curveLoc = ivec2(bandLoad(ivec2(hbandLoc.x + curveIndex, hbandLoc.y)).xy);

        vec4 p12 = curveLoad(curveLoc) - vec4(renderCoord, renderCoord);
        vec2 p3 = curveLoad(ivec2(curveLoc.x + 1, curveLoc.y)).xy - renderCoord;

        if (max(max(p12.x, p12.z), p3.x) * pixelsPerEm.x < -0.5) break;

        uint code = calcRootCode(p12.y, p12.w, p3.y);
        if (code != 0u) {
            vec2 r = solveHorizPoly(p12, p3) * pixelsPerEm.x;

            if ((code & 1u) != 0u) {
                xcov += clamp(r.x + 0.5, 0.0, 1.0);
                xwgt = max(xwgt, clamp(1.0 - abs(r.x) * 2.0, 0.0, 1.0));
            }

            if (code > 1u) {
                xcov -= clamp(r.y + 0.5, 0.0, 1.0);
                xwgt = max(xwgt, clamp(1.0 - abs(r.y) * 2.0, 0.0, 1.0));
            }
        }
    }

    float ycov = 0.0;
    float ywgt = 0.0;

    uvec2 vbandData = bandLoad(ivec2(glyphLoc.x + bandMax.y + 1 + bandIndex.x, glyphLoc.y)).xy;
    ivec2 vbandLoc = calcBandLoc(glyphLoc, vbandData.y);

    for (curveIndex = 0; curveIndex < int(vbandData.x); curveIndex++) {
        ivec2 curveLoc = ivec2(bandLoad(ivec2(vbandLoc.x + curveIndex, vbandLoc.y)).xy);
        vec4 p12 = curveLoad(curveLoc) - vec4(renderCoord, renderCoord);
        vec2 p3 = curveLoad(ivec2(curveLoc.x + 1, curveLoc.y)).xy - renderCoord;

        if (max(max(p12.y, p12.w), p3.y) * pixelsPerEm.y < -0.5) break;

        uint code = calcRootCode(p12.x, p12.z, p3.x);
        if (code != 0u) {
            vec2 r = solveVertPoly(p12, p3) * pixelsPerEm.y;

            if ((code & 1u) != 0u) {
                ycov -= clamp(r.x + 0.5, 0.0, 1.0);
                ywgt = max(ywgt, clamp(1.0 - abs(r.x) * 2.0, 0.0, 1.0));
            }

            if (code > 1u) {
                ycov += clamp(r.y + 0.5, 0.0, 1.0);
                ywgt = max(ywgt, clamp(1.0 - abs(r.y) * 2.0, 0.0, 1.0));
            }
        }
    }

    return calcCoverage(xcov, ycov, xwgt, ywgt);
}

uniform int uDebugMode;

void main() {
    if (uDebugMode == 1) {
        fragColor = vec4(vTexcoord.x / 700.0, vTexcoord.y / 700.0, 0.5, 1.0);
    } else {
        float coverage = slugRender(vTexcoord, vBanding, vGlyph);
        fragColor = vColor * coverage;
    }
}
