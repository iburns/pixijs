import type { GlyphBandData, QuadBezier, SlugBounds, SlugGlyph } from '../SlugTypes';

/**
 * Organize a glyph's curves into horizontal and vertical bands.
 * Band count is proportional to sqrt of curve count, capped at 16.
 */
export function organizeGlyphBands(glyph: SlugGlyph): GlyphBandData
{
    const { curves, bounds } = glyph;

    const bandCount = Math.max(1, Math.min(16, Math.ceil(Math.sqrt(curves.length))));

    const height = bounds.yMax - bounds.yMin;
    const width = bounds.xMax - bounds.xMin;

    // Float32 precision matching: must compute in Float32 to match GPU
    const _f32 = new Float32Array(4);

    _f32[0] = height > 0 ? bandCount / height : 0;
    _f32[1] = width > 0 ? bandCount / width : 0;
    _f32[2] = -bounds.yMin * _f32[0];
    _f32[3] = -bounds.xMin * _f32[1];

    const bandScaleY = _f32[0];
    const bandScaleX = _f32[1];
    const bandOffsetY = _f32[2];
    const bandOffsetX = _f32[3];

    const hBands = buildBands(curves, bandCount, 'horizontal', bandScaleY, bandOffsetY);
    const vBands = buildBands(curves, bandCount, 'vertical', bandScaleX, bandOffsetX);

    return {
        unicode: glyph.unicode,
        hBandCount: bandCount,
        vBandCount: bandCount,
        hBands,
        vBands,
        bandScaleX,
        bandScaleY,
        bandOffsetX,
        bandOffsetY,
    };
}

function buildBands(
    curves: QuadBezier[],
    bandCount: number,
    direction: 'horizontal' | 'vertical',
    bandScale: number,
    bandOffset: number,
): number[][]
{
    const isHorizontal = direction === 'horizontal';
    const bands: number[][] = Array.from({ length: bandCount }, () => []);

    for (let ci = 0; ci < curves.length; ci++)
    {
        const curveBounds = getCurveBounds(curves[ci]);

        const cMin = isHorizontal ? curveBounds.yMin : curveBounds.xMin;
        const cMax = isHorizontal ? curveBounds.yMax : curveBounds.xMax;

        // +/-1 band overlap for float32 rounding safety
        const rawStart = Math.floor((cMin * bandScale) + bandOffset);
        const rawEnd = Math.floor((cMax * bandScale) + bandOffset);
        const startBand = Math.max(0, rawStart - 1);
        const endBand = Math.min(bandCount - 1, rawEnd + 1);

        for (let bi = startBand; bi <= endBand; bi++)
        {
            bands[bi].push(ci);
        }
    }

    // Sort curves within each band
    for (const band of bands)
    {
        if (isHorizontal)
        {
            band.sort((a, b) =>
            {
                const aMax = Math.max(curves[a].p1[0], curves[a].p2[0], curves[a].p3[0]);
                const bMax = Math.max(curves[b].p1[0], curves[b].p2[0], curves[b].p3[0]);

                return bMax - aMax;
            });
        }
        else
        {
            band.sort((a, b) =>
            {
                const aMax = Math.max(curves[a].p1[1], curves[a].p2[1], curves[a].p3[1]);
                const bMax = Math.max(curves[b].p1[1], curves[b].p2[1], curves[b].p3[1]);

                return bMax - aMax;
            });
        }
    }

    return bands;
}

function getCurveBounds(curve: QuadBezier): SlugBounds
{
    return {
        xMin: Math.min(curve.p1[0], curve.p2[0], curve.p3[0]),
        yMin: Math.min(curve.p1[1], curve.p2[1], curve.p3[1]),
        xMax: Math.max(curve.p1[0], curve.p2[0], curve.p3[0]),
        yMax: Math.max(curve.p1[1], curve.p2[1], curve.p3[1]),
    };
}
