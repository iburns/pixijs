const kLogBandTextureWidth: u32 = 12u;

struct SlugUniforms {
    uViewport: vec2<f32>,
    uDebugMode: i32,
};

@group(2) @binding(0) var<uniform> slugUniforms: SlugUniforms;
@group(2) @binding(1) var uCurveTexture: texture_2d<f32>;
@group(2) @binding(2) var uBandTexture: texture_2d<f32>;

struct FragmentInput {
    @location(0) vTexcoord: vec2<f32>,
    @location(1) vColor: vec4<f32>,
    @location(2) @interpolate(flat) vBanding: vec4<f32>,
    @location(3) @interpolate(flat) vGlyphX: i32,
    @location(4) @interpolate(flat) vGlyphY: i32,
    @location(5) @interpolate(flat) vGlyphZ: i32,
    @location(6) @interpolate(flat) vGlyphW: i32,
};

fn curveLoad(loc: vec2<i32>) -> vec4<f32> {
    return textureLoad(uCurveTexture, loc, 0);
}

fn bandLoad(loc: vec2<i32>) -> vec4<u32> {
    let raw = textureLoad(uBandTexture, loc, 0);
    return vec4<u32>(bitcast<u32>(raw.x), bitcast<u32>(raw.y), bitcast<u32>(raw.z), bitcast<u32>(raw.w));
}

fn calcRootCode(y1: f32, y2: f32, y3: f32) -> u32 {
    let i1 = bitcast<u32>(y1) >> 31u;
    let i2 = bitcast<u32>(y2) >> 30u;
    let i3 = bitcast<u32>(y3) >> 29u;

    var shift = (i2 & 2u) | (i1 & ~2u);
    shift = (i3 & 4u) | (shift & ~4u);

    return (0x2E74u >> shift) & 0x0101u;
}

fn solveHorizPoly(p12: vec4<f32>, p3: vec2<f32>) -> vec2<f32> {
    let a = p12.xy - p12.zw * 2.0 + p3;
    let b = p12.xy - p12.zw;
    let ra = 1.0 / a.y;
    let rb = 0.5 / b.y;

    let d = sqrt(max(b.y * b.y - a.y * p12.y, 0.0));
    var t1 = (b.y - d) * ra;
    var t2 = (b.y + d) * ra;

    if (abs(a.y) < 1.0) {
        t1 = p12.y * rb;
        t2 = t1;
    }

    return vec2<f32>(
        (a.x * t1 - b.x * 2.0) * t1 + p12.x,
        (a.x * t2 - b.x * 2.0) * t2 + p12.x
    );
}

fn solveVertPoly(p12: vec4<f32>, p3: vec2<f32>) -> vec2<f32> {
    let a = p12.xy - p12.zw * 2.0 + p3;
    let b = p12.xy - p12.zw;
    let ra = 1.0 / a.x;
    let rb = 0.5 / b.x;

    let d = sqrt(max(b.x * b.x - a.x * p12.x, 0.0));
    var t1 = (b.x - d) * ra;
    var t2 = (b.x + d) * ra;

    if (abs(a.x) < 1.0) {
        t1 = p12.x * rb;
        t2 = t1;
    }

    return vec2<f32>(
        (a.y * t1 - b.y * 2.0) * t1 + p12.y,
        (a.y * t2 - b.y * 2.0) * t2 + p12.y
    );
}

fn calcBandLoc(glyphLoc: vec2<i32>, offset: u32) -> vec2<i32> {
    var bandLoc = vec2<i32>(glyphLoc.x + i32(offset), glyphLoc.y);
    bandLoc.y += bandLoc.x >> i32(kLogBandTextureWidth);
    bandLoc.x &= (1 << i32(kLogBandTextureWidth)) - 1;
    return bandLoc;
}

fn calcCoverage(xcov: f32, ycov: f32, xwgt: f32, ywgt: f32) -> f32 {
    var coverage = max(
        abs(xcov * xwgt + ycov * ywgt) / max(xwgt + ywgt, 1.0 / 65536.0),
        min(abs(xcov), abs(ycov))
    );
    return clamp(coverage, 0.0, 1.0);
}

fn slugRender(renderCoord: vec2<f32>, bandTransform: vec4<f32>, glyphData: vec4<i32>) -> f32 {
    let emsPerPixel = fwidthFine(renderCoord);
    let pixelsPerEm = 1.0 / emsPerPixel;

    var bandMax = glyphData.zw;
    bandMax.y &= 0x00FF;

    let bandIndex = clamp(
        vec2<i32>(vec2<f32>(renderCoord * bandTransform.xy + bandTransform.zw)),
        vec2<i32>(0, 0),
        bandMax
    );
    let glyphLoc = glyphData.xy;

    var xcov: f32 = 0.0;
    var xwgt: f32 = 0.0;

    let hbandData = bandLoad(vec2<i32>(glyphLoc.x + bandIndex.y, glyphLoc.y)).xy;
    let hbandLoc = calcBandLoc(glyphLoc, hbandData.y);

    for (var curveIndex: i32 = 0; curveIndex < i32(hbandData.x); curveIndex++) {
        let curveLoc = vec2<i32>(bandLoad(vec2<i32>(hbandLoc.x + curveIndex, hbandLoc.y)).xy);

        let p12 = curveLoad(curveLoc) - vec4<f32>(renderCoord, renderCoord);
        let p3 = curveLoad(vec2<i32>(curveLoc.x + 1, curveLoc.y)).xy - renderCoord;

        if (max(max(p12.x, p12.z), p3.x) * pixelsPerEm.x < -0.5) { break; }

        let code = calcRootCode(p12.y, p12.w, p3.y);
        if (code != 0u) {
            let r = solveHorizPoly(p12, p3) * pixelsPerEm.x;

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

    var ycov: f32 = 0.0;
    var ywgt: f32 = 0.0;

    let vbandData = bandLoad(vec2<i32>(glyphLoc.x + bandMax.y + 1 + bandIndex.x, glyphLoc.y)).xy;
    let vbandLoc = calcBandLoc(glyphLoc, vbandData.y);

    for (var curveIndex: i32 = 0; curveIndex < i32(vbandData.x); curveIndex++) {
        let curveLoc = vec2<i32>(bandLoad(vec2<i32>(vbandLoc.x + curveIndex, vbandLoc.y)).xy);
        let p12 = curveLoad(curveLoc) - vec4<f32>(renderCoord, renderCoord);
        let p3 = curveLoad(vec2<i32>(curveLoc.x + 1, curveLoc.y)).xy - renderCoord;

        if (max(max(p12.y, p12.w), p3.y) * pixelsPerEm.y < -0.5) { break; }

        let code = calcRootCode(p12.x, p12.z, p3.x);
        if (code != 0u) {
            let r = solveVertPoly(p12, p3) * pixelsPerEm.y;

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

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
    let glyphData = vec4<i32>(input.vGlyphX, input.vGlyphY, input.vGlyphZ, input.vGlyphW);

    if (slugUniforms.uDebugMode == 1) {
        return vec4<f32>(input.vTexcoord.x / 700.0, input.vTexcoord.y / 700.0, 0.5, 1.0);
    }

    let coverage = slugRender(input.vTexcoord, input.vBanding, glyphData);
    return input.vColor * coverage;
}
