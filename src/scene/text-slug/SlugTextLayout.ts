import { Geometry } from '../../rendering/renderers/shared/geometry/Geometry';

import type { SlugAtlas } from './SlugAtlas';
import type { GlyphAtlasEntry, SlugFontData } from './SlugTypes';

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

/**
 * Build a PIXI Geometry for Slug text rendering.
 */
export function buildSlugGeometry(
    atlas: SlugAtlas,
    fontData: SlugFontData,
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

    const scale = fontSize / fontData.unitsPerEm;
    const defaultLineHeight = (fontData.ascender - fontData.descender) * scale;
    const lineHeight = customLineHeight ?? defaultLineHeight;

    // Split text into lines (handle word wrap if enabled)
    const lines = wordWrap && wordWrapWidth > 0
        ? wrapText(text, atlas, fontData, scale, letterSpacing, wordWrapWidth)
        : text.split('\n');

    // Calculate line widths for alignment
    const lineWidths = lines.map((line) => measureLine(line, atlas, fontData, scale, letterSpacing));
    const maxWidth = Math.max(...lineWidths, 0);

    const positions: number[] = [];
    const texcoords: number[] = [];
    const jacobians: number[] = [];
    const banding: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let vertexCount = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++)
    {
        const line = lines[lineIdx];
        const lineWidth = lineWidths[lineIdx];

        let offsetX = 0;

        if (align === 'center') offsetX = (maxWidth - lineWidth) / 2;
        else if (align === 'right') offsetX = maxWidth - lineWidth;

        let cursorX = offsetX;
        const cursorY = lineIdx * lineHeight;
        let prevCodepoint: number | null = null;

        for (const char of line)
        {
            const codepoint = char.codePointAt(0)!;

            if (prevCodepoint !== null)
            {
                cursorX += fontData.getKerning(prevCodepoint, codepoint) * scale;
            }

            const entry = atlas.getGlyphInfo(codepoint);

            if (!entry)
            {
                cursorX += fontSize * 0.3;
                prevCodepoint = codepoint;
                continue;
            }

            appendGlyphQuad(
                entry, cursorX, cursorY, scale, color,
                positions, texcoords, jacobians, banding, colors, indices,
                vertexCount,
            );

            vertexCount += 4;
            cursorX += (entry.advanceWidth * scale) + letterSpacing;
            prevCodepoint = codepoint;
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
    const jacXX = invScale;
    const jacXY = 0;
    const jacYX = 0;
    const jacYY = -invScale;

    // Outward normals for dilation: BL, BR, TR, TL
    const normals: [number, number][] = [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
    ];

    // Vertex corners: BL, BR, TR, TL
    const corners = [
        { x: x0, y: y1, emX: emX0, emY: emY0 },
        { x: x1, y: y1, emX: emX1, emY: emY0 },
        { x: x1, y: y0, emX: emX1, emY: emY1 },
        { x: x0, y: y0, emX: emX0, emY: emY1 },
    ];

    for (let i = 0; i < 4; i++)
    {
        const c = corners[i];
        const n = normals[i];

        positions.push(c.x, c.y, n[0], n[1]);
        texcoords.push(c.emX, c.emY, packedZ, packedW);
        jacobians.push(jacXX, jacXY, jacYX, jacYY);
        banding.push(entry.bandScaleX, entry.bandScaleY, entry.bandOffsetX, entry.bandOffsetY);
        colors.push(color[0], color[1], color[2], color[3]);
    }

    indices.push(
        baseVertex + 0, baseVertex + 1, baseVertex + 2,
        baseVertex + 0, baseVertex + 2, baseVertex + 3,
    );
}

function uint32BitsToFloat(bits: number): number
{
    const buf = new ArrayBuffer(4);

    new Uint32Array(buf)[0] = bits >>> 0;

    return new Float32Array(buf)[0];
}

function measureLine(
    line: string,
    _atlas: SlugAtlas,
    fontData: SlugFontData,
    scale: number,
    letterSpacing: number,
): number
{
    let width = 0;
    let prevCodepoint: number | null = null;
    let charCount = 0;

    for (const char of line)
    {
        const cp = char.codePointAt(0)!;

        if (prevCodepoint !== null)
        {
            width += fontData.getKerning(prevCodepoint, cp) * scale;
        }

        const glyph = fontData.glyphs.get(cp);

        if (glyph)
        {
            width += glyph.advanceWidth * scale;
        }
        else
        {
            width += scale * fontData.unitsPerEm * 0.3;
        }

        prevCodepoint = cp;
        charCount++;
    }

    if (charCount > 1)
    {
        width += letterSpacing * (charCount - 1);
    }

    return width;
}

function wrapText(
    text: string,
    atlas: SlugAtlas,
    fontData: SlugFontData,
    scale: number,
    letterSpacing: number,
    wrapWidth: number,
): string[]
{
    const result: string[] = [];
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs)
    {
        const words = paragraph.split(' ');
        let currentLine = '';

        for (const word of words)
        {
            const testLine = currentLine.length === 0 ? word : `${currentLine} ${word}`;
            const testWidth = measureLine(testLine, atlas, fontData, scale, letterSpacing);

            if (testWidth > wrapWidth && currentLine.length > 0)
            {
                result.push(currentLine);
                currentLine = word;
            }
            else
            {
                currentLine = testLine;
            }
        }

        result.push(currentLine);
    }

    return result;
}
