import type { GlyphAtlasEntry, GlyphBandData, SlugGlyph } from '../SlugTypes';

const TEXTURE_WIDTH = 4096;

export interface PackedTextures
{
    curveData: Float32Array;
    curveWidth: number;
    curveHeight: number;
    bandData: Uint32Array;
    bandWidth: number;
    bandHeight: number;
    atlas: Map<number, GlyphAtlasEntry>;
}

/**
 * Pack multiple glyphs into curve and band textures.
 * Ensures no curve pair or band block straddles a row boundary.
 */
export function packTextures(
    glyphs: SlugGlyph[],
    bandDataList: GlyphBandData[],
): PackedTextures
{
    const atlas = new Map<number, GlyphAtlasEntry>();

    // First pass: calculate total texels needed
    let totalCurveTexels = 0;
    let totalBandTexels = 0;

    for (let gi = 0; gi < glyphs.length; gi++)
    {
        const glyph = glyphs[gi];
        const bandData = bandDataList[gi];

        for (let ci = 0; ci < glyph.curves.length; ci++)
        {
            if (totalCurveTexels % TEXTURE_WIDTH === TEXTURE_WIDTH - 1)
            {
                totalCurveTexels++;
            }
            totalCurveTexels += 2;
        }

        const headerTexels = bandData.hBandCount + bandData.vBandCount;
        let listTexels = 0;

        for (const band of bandData.hBands) listTexels += band.length;
        for (const band of bandData.vBands) listTexels += band.length;
        const glyphBandTexels = headerTexels + listTexels;

        const remainingInRow = TEXTURE_WIDTH - (totalBandTexels % TEXTURE_WIDTH);

        if (glyphBandTexels > remainingInRow && remainingInRow < TEXTURE_WIDTH)
        {
            totalBandTexels += remainingInRow;
        }
        totalBandTexels += glyphBandTexels;
    }

    const curveHeight = Math.max(1, Math.ceil(totalCurveTexels / TEXTURE_WIDTH));
    const bandHeight = Math.max(1, Math.ceil(totalBandTexels / TEXTURE_WIDTH));

    const curveData = new Float32Array(TEXTURE_WIDTH * curveHeight * 4);
    const bandData = new Uint32Array(TEXTURE_WIDTH * bandHeight * 4);

    // Second pass: pack data
    let curveOffset = 0;
    let bandOffset = 0;

    for (let gi = 0; gi < glyphs.length; gi++)
    {
        const glyph = glyphs[gi];
        const bd = bandDataList[gi];

        // Pack curves
        const curvePositions: Array<{ x: number; y: number }> = [];

        for (const curve of glyph.curves)
        {
            if (curveOffset % TEXTURE_WIDTH === TEXTURE_WIDTH - 1)
            {
                curveOffset++;
            }

            const cx = curveOffset % TEXTURE_WIDTH;
            const cy = Math.floor(curveOffset / TEXTURE_WIDTH);

            curvePositions.push({ x: cx, y: cy });

            writeCurveTexel(curveData, curveOffset, curve.p1[0], curve.p1[1], curve.p2[0], curve.p2[1]);
            curveOffset++;
            writeCurveTexel(curveData, curveOffset, curve.p3[0], curve.p3[1], 0, 0);
            curveOffset++;
        }

        // Pack band data
        const totalHeaders = bd.hBandCount + bd.vBandCount;
        let totalListTexels = 0;

        for (const band of bd.hBands) totalListTexels += band.length;
        for (const band of bd.vBands) totalListTexels += band.length;
        const glyphBandTexels = totalHeaders + totalListTexels;

        const remainingInRow = TEXTURE_WIDTH - (bandOffset % TEXTURE_WIDTH);

        if (glyphBandTexels > remainingInRow && remainingInRow < TEXTURE_WIDTH)
        {
            bandOffset += remainingInRow;
        }

        const bandStartX = bandOffset % TEXTURE_WIDTH;
        const bandStartY = Math.floor(bandOffset / TEXTURE_WIDTH);

        let listOffset = bandOffset + totalHeaders;

        // Write horizontal band headers
        for (let bi = 0; bi < bd.hBandCount; bi++)
        {
            const curveCount = bd.hBands[bi].length;
            const dataOffset = listOffset - bandOffset;

            writeBandTexel(bandData, bandOffset + bi, curveCount, dataOffset, 0, 0);

            for (let ci = 0; ci < curveCount; ci++)
            {
                const curveIndex = bd.hBands[bi][ci];
                const pos = curvePositions[curveIndex];

                writeBandTexel(bandData, listOffset, pos.x, pos.y, 0, 0);
                listOffset++;
            }
        }

        // Write vertical band headers
        for (let bi = 0; bi < bd.vBandCount; bi++)
        {
            const headerIdx = bandOffset + bd.hBandCount + bi;
            const curveCount = bd.vBands[bi].length;
            const dataOffset = listOffset - bandOffset;

            writeBandTexel(bandData, headerIdx, curveCount, dataOffset, 0, 0);

            for (let ci = 0; ci < curveCount; ci++)
            {
                const curveIndex = bd.vBands[bi][ci];
                const pos = curvePositions[curveIndex];

                writeBandTexel(bandData, listOffset, pos.x, pos.y, 0, 0);
                listOffset++;
            }
        }

        atlas.set(glyph.unicode, {
            curveTexelX: curvePositions.length > 0 ? curvePositions[0].x : 0,
            curveTexelY: curvePositions.length > 0 ? curvePositions[0].y : 0,
            bandTexelX: bandStartX,
            bandTexelY: bandStartY,
            hBandMax: bd.hBandCount - 1,
            vBandMax: bd.vBandCount - 1,
            bandScaleX: bd.bandScaleX,
            bandScaleY: bd.bandScaleY,
            bandOffsetX: bd.bandOffsetX,
            bandOffsetY: bd.bandOffsetY,
            bounds: glyph.bounds,
            advanceWidth: glyph.advanceWidth,
        });

        bandOffset = listOffset;
    }

    return {
        curveData,
        curveWidth: TEXTURE_WIDTH,
        curveHeight,
        bandData,
        bandWidth: TEXTURE_WIDTH,
        bandHeight,
        atlas,
    };
}

function writeCurveTexel(
    data: Float32Array,
    texelIndex: number,
    r: number, g: number, b: number, a: number,
): void
{
    const row = Math.floor(texelIndex / TEXTURE_WIDTH);
    const col = texelIndex % TEXTURE_WIDTH;
    const idx = ((row * TEXTURE_WIDTH) + col) * 4;

    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
}

function writeBandTexel(
    data: Uint32Array,
    texelIndex: number,
    r: number, g: number, b: number, a: number,
): void
{
    const row = Math.floor(texelIndex / TEXTURE_WIDTH);
    const col = texelIndex % TEXTURE_WIDTH;
    const idx = ((row * TEXTURE_WIDTH) + col) * 4;

    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
}
