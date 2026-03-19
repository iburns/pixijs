struct GlobalUniforms {
    uProjectionMatrix: mat3x3<f32>,
    uWorldTransformMatrix: mat3x3<f32>,
    uWorldColorAlpha: vec4<f32>,
    uResolution: vec2<f32>,
};

struct LocalUniforms {
    uTransformMatrix: mat3x3<f32>,
    uColor: vec4<f32>,
    uRound: f32,
};

struct SlugUniforms {
    uViewport: vec2<f32>,
    uDebugMode: i32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> slugUniforms: SlugUniforms;

struct VertexInput {
    @location(0) aPos: vec4<f32>,
    @location(1) aTex: vec4<f32>,
    @location(2) aJac: vec4<f32>,
    @location(3) aBnd: vec4<f32>,
    @location(4) aCol: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) vTexcoord: vec2<f32>,
    @location(1) vColor: vec4<f32>,
    @location(2) @interpolate(flat) vBanding: vec4<f32>,
    @location(3) @interpolate(flat) vGlyphX: i32,
    @location(4) @interpolate(flat) vGlyphY: i32,
    @location(5) @interpolate(flat) vGlyphZ: i32,
    @location(6) @interpolate(flat) vGlyphW: i32,
};

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;

    let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
    let viewport = slugUniforms.uViewport;

    // Dilation
    let scaleX = length(vec2<f32>(mvp[0][0], mvp[1][0]));
    let scaleY = length(vec2<f32>(mvp[0][1], mvp[1][1]));

    let halfPixelX = 1.0 / (scaleX * viewport.x);
    let halfPixelY = 1.0 / (scaleY * viewport.y);

    let n = normalize(input.aPos.zw);
    let d = n * vec2<f32>(halfPixelX, halfPixelY);

    let dilatedPos = input.aPos.xy + d;
    let dilatedTex = vec2<f32>(
        input.aTex.x + dot(d, input.aJac.xy),
        input.aTex.y + dot(d, input.aJac.zw)
    );

    let clipPos = mvp * vec3<f32>(dilatedPos, 1.0);
    output.position = vec4<f32>(clipPos.xy, 0.0, 1.0);
    output.vTexcoord = dilatedTex;

    // Unpack glyph data
    let gz = bitcast<u32>(input.aTex.z);
    let gw = bitcast<u32>(input.aTex.w);
    output.vGlyphX = i32(gz & 0xFFFFu);
    output.vGlyphY = i32(gz >> 16u);
    output.vGlyphZ = i32(gw & 0xFFFFu);
    output.vGlyphW = i32(gw >> 16u);

    output.vBanding = input.aBnd;
    output.vColor = input.aCol;

    return output;
}
