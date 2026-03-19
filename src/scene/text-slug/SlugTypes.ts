/** A single quadratic Bezier curve with three 2D control points. */
export interface QuadBezier
{
    p1: [number, number];
    p2: [number, number];
    p3: [number, number];
}

/** Axis-aligned bounding box. */
export interface SlugBounds
{
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
}

/** Parsed glyph data with Bezier outlines in em-space coordinates. */
export interface SlugGlyph
{
    unicode: number;
    glyphId: number;
    advanceWidth: number;
    bounds: SlugBounds;
    curves: QuadBezier[];
}

/** Parsed font with glyph outlines ready for band organization. */
export interface SlugFontData
{
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: Map<number, SlugGlyph>;
    glyphsById: Map<number, SlugGlyph>;
    rawBuffer: ArrayBuffer;
    getKerning(cp1: number, cp2: number): number;
    getGlyphByIndex(glyphId: number): SlugGlyph | null;
}

/** Band data for a single glyph, ready for texture packing. */
export interface GlyphBandData
{
    unicode: number;
    hBandCount: number;
    vBandCount: number;
    hBands: number[][];
    vBands: number[][];
    bandScaleX: number;
    bandScaleY: number;
    bandOffsetX: number;
    bandOffsetY: number;
}

/** Location of a glyph's data within the packed GPU textures. */
export interface GlyphAtlasEntry
{
    curveTexelX: number;
    curveTexelY: number;
    bandTexelX: number;
    bandTexelY: number;
    hBandMax: number;
    vBandMax: number;
    bandScaleX: number;
    bandScaleY: number;
    bandOffsetX: number;
    bandOffsetY: number;
    bounds: SlugBounds;
    advanceWidth: number;
}
