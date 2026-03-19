in vec4 aPos;
in vec4 aTex;
in vec4 aJac;
in vec4 aBnd;
in vec4 aCol;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

uniform vec2 uViewport;

out vec2 vTexcoord;
out vec4 vColor;
flat out vec4 vBanding;
flat out ivec4 vGlyph;

void slugUnpack(vec4 tex, vec4 bnd, out vec4 outBnd, out ivec4 outGly) {
    uvec2 g = floatBitsToUint(tex.zw);
    outGly = ivec4(
        int(g.x & 0xFFFFu),
        int(g.x >> 16u),
        int(g.y & 0xFFFFu),
        int(g.y >> 16u)
    );
    outBnd = bnd;
}

vec2 slugDilate(vec4 pos, vec4 tex, vec4 jac, vec2 viewport, mat3 mvp, out vec2 outPos) {
    float scaleX = length(vec2(mvp[0][0], mvp[1][0]));
    float scaleY = length(vec2(mvp[0][1], mvp[1][1]));

    float halfPixelX = 1.0 / (scaleX * viewport.x);
    float halfPixelY = 1.0 / (scaleY * viewport.y);

    vec2 n = normalize(pos.zw);
    vec2 d = n * vec2(halfPixelX, halfPixelY);

    outPos = pos.xy + d;

    return vec2(tex.x + dot(d, jac.xy), tex.y + dot(d, jac.zw));
}

void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;

    vec2 dilatedPos;
    vTexcoord = slugDilate(aPos, aTex, aJac, uViewport, mvp, dilatedPos);

    vec3 clipPos = mvp * vec3(dilatedPos, 1.0);
    gl_Position = vec4(clipPos.xy, 0.0, 1.0);

    slugUnpack(aTex, aBnd, vBanding, vGlyph);
    vColor = aCol;
}
