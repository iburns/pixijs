import { Geometry } from '../../rendering/renderers/shared/geometry/Geometry';

import type { SlugFont } from './SlugFont';
import type { GlyphAtlasEntry } from './SlugTypes';
import type { ShapedGlyph } from './utils/harfbuzzShaper';

export interface SlugTextLayoutOptions
{
    text: string;
    fontSize: number;
    color: [number, number, number, number];
    letterSpacing?: number;
    lineHeight?: number;
    align?: 'left' | 'center' | 'right';
    wordWrap?: boolean;
    wordWrapWidth?: number;
}

// Shared buffer for uint32-to-float bit reinterpretation (avoids per-call allocation)
const _u32Buf = new ArrayBuffer(4);
const _u32View = new Uint32Array(_u32Buf);
const _f32View = new Float32Array(_u32Buf);

/**
 * Build a PIXI Geometry for Slug text rendering.
 */
export function buildSlugGeometry(
    font: SlugFont,
    options: SlugTextLayoutOptions,
): Geometry
{
    const {
        text,
        fontSize,
        color,
        letterSpacing = 0,
        lineHeight: customLineHeight,
        align = 'left',
        wordWrap = false,
        wordWrapWidth = 0,
    } = options;

    const atlas = font.atlas;
    const fontData = font.fontData;
    const scale = fontSize / fontData.unitsPerEm;
    const defaultLineHeight = (fontData.ascender - fontData.descender) * scale;
    const lineHeight = customLineHeight ?? defaultLineHeight;

    // Split text into lines, shaping each line once and caching the result
    const rawLines = text.split('\n');
    const lines: string[] = [];
    const shapedLines: ShapedGlyph[][] = [];

    if (wordWrap && wordWrapWidth > 0)
    {
        // Word wrap: shape words and measure to determine line breaks
        for (const paragraph of rawLines)
        {
            const words = paragraph.split(' ');
            let currentLine = '';

            for (const word of words)
            {
                const testLine = currentLine.length === 0 ? word : `${currentLine} ${word}`;
                const testShaped = font.shape(testLine);
                const testWidth = measureShaped(testShaped, scale, letterSpacing);

                if (testWidth > wordWrapWidth && currentLine.length > 0)
                {
                    // Commit current line (shape it for final use)
                    const shaped = font.shape(currentLine);

                    lines.push(currentLine);
                    shapedLines.push(shaped);
                    currentLine = word;
                }
                else
                {
                    currentLine = testLine;
                }
            }

            // Commit final line of paragraph
            const shaped = font.shape(currentLine);

            lines.push(currentLine);
            shapedLines.push(shaped);
        }
    }
    else
    {
        for (const line of rawLines)
        {
            lines.push(line);
            shapedLines.push(font.shape(line));
        }
    }

    // Measure line widths from cached shaped results (no re-shaping)
    const lineWidths = shapedLines.map((shaped) => measureShaped(shaped, scale, letterSpacing));
    const maxWidth = Math.max(...lineWidths, 0);

    // Ensure all glyph IDs are in the atlas in one pass
    const allGlyphIds: Set<number> = new Set();

    for (const shaped of shapedLines)
    {
        for (const sg of shaped)
        {
            allGlyphIds.add(sg.glyphId);
        }
    }
    atlas.ensureGlyphIds(Array.from(allGlyphIds));

    const positions: number[] = [];
    const texcoords: number[] = [];
    const jacobians: number[] = [];
    const banding: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let vertexCount = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++)
    {
        const lineWidth = lineWidths[lineIdx];
        const shapedGlyphs = shapedLines[lineIdx];

        let offsetX = 0;

        if (align === 'center') offsetX = (maxWidth - lineWidth) / 2;
        else if (align === 'right') offsetX = maxWidth - lineWidth;

        let cursorX = offsetX;
        const baselineY = (fontData.ascender * scale) + (lineIdx * lineHeight);

        let prevCluster = -1;

        for (const sg of shapedGlyphs)
        {
            const entry = atlas.getGlyphInfo(sg.glyphId);

            if (!entry)
            {
                cursorX += (sg.xAdvance * scale);

                if (prevCluster !== -1 && sg.cluster !== prevCluster)
                {
                    cursorX += letterSpacing;
                }
                prevCluster = sg.cluster;
                continue;
            }

            const glyphX = cursorX + (sg.xOffset * scale);
            const glyphY = baselineY - (sg.yOffset * scale);

            appendGlyphQuad(
                entry, glyphX, glyphY, scale, color,
                positions, texcoords, jacobians, banding, colors, indices,
                vertexCount,
            );

            vertexCount += 4;
            cursorX += (sg.xAdvance * scale);

            if (prevCluster !== -1 && sg.cluster !== prevCluster)
            {
                cursorX += letterSpacing;
            }
            prevCluster = sg.cluster;
        }
    }

    return new Geometry({
        attributes: {
            aPos: { buffer: new Float32Array(positions), format: 'float32x4' },
            aTex: { buffer: new Float32Array(texcoords), format: 'float32x4' },
            aJac: { buffer: new Float32Array(jacobians), format: 'float32x4' },
            aBnd: { buffer: new Float32Array(banding), format: 'float32x4' },
            aCol: { buffer: new Float32Array(colors), format: 'float32x4' },
        },
        indexBuffer: new Uint32Array(indices),
    });
}

function appendGlyphQuad(
    entry: GlyphAtlasEntry,
    screenX: number,
    screenY: number,
    scale: number,
    color: [number, number, number, number],
    positions: number[],
    texcoords: number[],
    jacobians: number[],
    banding: number[],
    colors: number[],
    indices: number[],
    baseVertex: number,
): void
{
    const { bounds } = entry;
    const emPad = 1.0 / scale;

    // Screen-space quad corners (Y-down)
    const x0 = screenX + ((bounds.xMin - emPad) * scale);
    const y0 = screenY - ((bounds.yMax + emPad) * scale);
    const x1 = screenX + ((bounds.xMax + emPad) * scale);
    const y1 = screenY - ((bounds.yMin - emPad) * scale);

    // Em-space coordinates
    const emX0 = bounds.xMin - emPad;
    const emY0 = bounds.yMin - emPad;
    const emX1 = bounds.xMax + emPad;
    const emY1 = bounds.yMax + emPad;

    // Pack glyph location and band max values (bits mode)
    const glyphLocBits = (entry.bandTexelY << 16) | (entry.bandTexelX & 0xFFFF);
    const bandMaxBits = (entry.hBandMax << 16) | (entry.vBandMax & 0xFFFF);
    const packedZ = uint32BitsToFloat(glyphLocBits);
    const packedW = uint32BitsToFloat(bandMaxBits);

    // Inverse Jacobian
    const invScale = 1.0 / scale;

    const bsx = entry.bandScaleX;
    const bsy = entry.bandScaleY;
    const box = entry.bandOffsetX;
    const boy = entry.bandOffsetY;
    const cr = color[0];
    const cg = color[1];
    const cb = color[2];
    const ca = color[3];

    // BL vertex (normal: -1, 1)
    positions.push(x0, y1, -1, 1);
    texcoords.push(emX0, emY0, packedZ, packedW);
    jacobians.push(invScale, 0, 0, -invScale);
    banding.push(bsx, bsy, box, boy);
    colors.push(cr, cg, cb, ca);

    // BR vertex (normal: 1, 1)
    positions.push(x1, y1, 1, 1);
    texcoords.push(emX1, emY0, packedZ, packedW);
    jacobians.push(invScale, 0, 0, -invScale);
    banding.push(bsx, bsy, box, boy);
    colors.push(cr, cg, cb, ca);

    // TR vertex (normal: 1, -1)
    positions.push(x1, y0, 1, -1);
    texcoords.push(emX1, emY1, packedZ, packedW);
    jacobians.push(invScale, 0, 0, -invScale);
    banding.push(bsx, bsy, box, boy);
    colors.push(cr, cg, cb, ca);

    // TL vertex (normal: -1, -1)
    positions.push(x0, y0, -1, -1);
    texcoords.push(emX0, emY1, packedZ, packedW);
    jacobians.push(invScale, 0, 0, -invScale);
    banding.push(bsx, bsy, box, boy);
    colors.push(cr, cg, cb, ca);

    indices.push(
        baseVertex, baseVertex + 1, baseVertex + 2,
        baseVertex, baseVertex + 2, baseVertex + 3,
    );
}

function uint32BitsToFloat(bits: number): number
{
    _u32View[0] = bits >>> 0;

    return _f32View[0];
}

/**
 * Measure width from pre-shaped glyphs (avoids re-shaping).
 */
function measureShaped(
    shapedGlyphs: ShapedGlyph[],
    scale: number,
    letterSpacing: number,
): number
{
    let width = 0;
    let prevCluster = -1;

    for (const sg of shapedGlyphs)
    {
        width += sg.xAdvance * scale;

        if (prevCluster !== -1 && sg.cluster !== prevCluster)
        {
            width += letterSpacing;
        }
        prevCluster = sg.cluster;
    }

    return width;
}
