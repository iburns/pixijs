// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - opentype.js has no type declarations
import opentype from 'opentype.js';

import type { QuadBezier, SlugBounds, SlugFontData, SlugGlyph } from '../SlugTypes';

/**
 * Parse a TTF/OTF font from a URL and extract glyph outlines as quadratic Bezier curves.
 */
export async function parseSlugFont(url: string): Promise<SlugFontData>
{
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    return parseSlugFontFromBuffer(buffer);
}

/**
 * Parse a TTF/OTF font from an ArrayBuffer.
 */
export function parseSlugFontFromBuffer(buffer: ArrayBuffer): SlugFontData
{
    const font = opentype.parse(buffer);

    const glyphs = new Map<number, SlugGlyph>();
    const cubicStats = { count: 0 };

    for (let i = 0; i < font.glyphs.length; i++)
    {
        const glyph = font.glyphs.get(i);

        if (!glyph || glyph.unicode === undefined) continue;

        const slugGlyph = extractGlyph(glyph, font.unitsPerEm, cubicStats);

        if (slugGlyph)
        {
            glyphs.set(slugGlyph.unicode, slugGlyph);
        }
    }

    if (cubicStats.count > 0)
    {
        // eslint-disable-next-line no-console
        console.warn(
            `[SlugFont] Font uses CFF/cubic outlines: ${cubicStats.count} cubic segments were approximated as quadratics`,
        );
    }

    return {
        unitsPerEm: font.unitsPerEm,
        ascender: font.ascender,
        descender: font.descender,
        glyphs,
        getKerning(cp1: number, cp2: number): number
        {
            const g1 = font.charToGlyph(String.fromCodePoint(cp1));
            const g2 = font.charToGlyph(String.fromCodePoint(cp2));

            if (!g1 || !g2) return 0;

            return font.getKerningValue(g1, g2);
        },
    };
}

function extractGlyph(
    glyph: opentype.Glyph,
    unitsPerEm: number,
    cubicStats?: { count: number }
): SlugGlyph | null
{
    const path = glyph.getPath(0, 0, unitsPerEm);
    const commands = path.commands;

    if (commands.length === 0) return null;

    const curves: QuadBezier[] = [];
    let currentX = 0;
    let currentY = 0;
    let contourStartX = 0;
    let contourStartY = 0;

    for (const cmd of commands)
    {
        switch (cmd.type)
        {
            case 'M':
                currentX = cmd.x;
                currentY = -cmd.y;
                contourStartX = cmd.x;
                contourStartY = -cmd.y;
                break;

            case 'L':
            {
                const lx = cmd.x;
                const ly = -cmd.y;

                curves.push({
                    p1: [currentX, currentY],
                    p2: [(currentX + lx) / 2, (currentY + ly) / 2],
                    p3: [lx, ly],
                });
                currentX = lx;
                currentY = ly;
                break;
            }

            case 'Q':
            {
                const qx = cmd.x;
                const qy = -cmd.y;
                const qx1 = cmd.x1;
                const qy1 = -cmd.y1;

                curves.push({
                    p1: [currentX, currentY],
                    p2: [qx1, qy1],
                    p3: [qx, qy],
                });
                currentX = qx;
                currentY = qy;
                break;
            }

            case 'C':
                if (cubicStats) cubicStats.count++;
                approximateCubicWithQuadratics(
                    currentX, currentY,
                    cmd.x1, -cmd.y1,
                    cmd.x2, -cmd.y2,
                    cmd.x, -cmd.y,
                    curves,
                );
                currentX = cmd.x;
                currentY = -cmd.y;
                break;

            case 'Z':
                if (
                    Math.abs(currentX - contourStartX) > 1e-6
                    || Math.abs(currentY - contourStartY) > 1e-6
                )
                {
                    curves.push({
                        p1: [currentX, currentY],
                        p2: [(currentX + contourStartX) / 2, (currentY + contourStartY) / 2],
                        p3: [contourStartX, contourStartY],
                    });
                }
                currentX = contourStartX;
                currentY = contourStartY;
                break;
        }
    }

    if (curves.length === 0) return null;

    const bounds = computeBounds(curves);

    return {
        unicode: glyph.unicode!,
        advanceWidth: glyph.advanceWidth ?? 0,
        bounds,
        curves,
    };
}

function approximateCubicWithQuadratics(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    out: QuadBezier[],
    maxError = 1.0,
    depth = 0,
): void
{
    const qcx = (3 * (x1 + x2) - x0 - x3) / 4;
    const qcy = (3 * (y1 + y2) - y0 - y3) / 4;

    const mx01 = (x0 + x1) / 2;
    const my01 = (y0 + y1) / 2;
    const mx12 = (x1 + x2) / 2;
    const my12 = (y1 + y2) / 2;
    const mx23 = (x2 + x3) / 2;
    const my23 = (y2 + y3) / 2;

    const mx012 = (mx01 + mx12) / 2;
    const my012 = (my01 + my12) / 2;
    const mx123 = (mx12 + mx23) / 2;
    const my123 = (my12 + my23) / 2;

    const cubicMidX = (mx012 + mx123) / 2;
    const cubicMidY = (my012 + my123) / 2;

    const quadMidX = (0.25 * x0) + (0.5 * qcx) + (0.25 * x3);
    const quadMidY = (0.25 * y0) + (0.5 * qcy) + (0.25 * y3);

    const errX = cubicMidX - quadMidX;
    const errY = cubicMidY - quadMidY;
    const err = (errX * errX) + (errY * errY);

    if (err <= maxError * maxError || depth >= 4)
    {
        out.push({ p1: [x0, y0], p2: [qcx, qcy], p3: [x3, y3] });

        return;
    }

    approximateCubicWithQuadratics(
        x0, y0, mx01, my01, mx012, my012, cubicMidX, cubicMidY,
        out, maxError, depth + 1,
    );
    approximateCubicWithQuadratics(
        cubicMidX, cubicMidY, mx123, my123, mx23, my23, x3, y3,
        out, maxError, depth + 1,
    );
}

function computeBounds(curves: QuadBezier[]): SlugBounds
{
    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;

    for (const c of curves)
    {
        for (const p of [c.p1, c.p2, c.p3])
        {
            if (p[0] < xMin) xMin = p[0];
            if (p[1] < yMin) yMin = p[1];
            if (p[0] > xMax) xMax = p[0];
            if (p[1] > yMax) yMax = p[1];
        }
    }

    return { xMin, yMin, xMax, yMax };
}
