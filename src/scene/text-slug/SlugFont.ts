import { SlugAtlas } from './SlugAtlas';

import type { SlugFontData } from './SlugTypes';
import { parseSlugFont, parseSlugFontFromBuffer } from './utils/fontParser';

const fontCache = new Map<string, SlugFont>();

/**
 * A Slug font with parsed glyph data and a dynamic atlas.
 */
export class SlugFont
{
    public readonly fontData: SlugFontData;
    public readonly atlas: SlugAtlas;

    constructor(fontData: SlugFontData)
    {
        this.fontData = fontData;
        this.atlas = new SlugAtlas(fontData);
    }

    /**
     * Load a SlugFont from a URL. Results are cached by URL.
     */
    public static async from(url: string): Promise<SlugFont>
    {
        if (fontCache.has(url))
        {
            return fontCache.get(url)!;
        }

        const fontData = await parseSlugFont(url);
        const font = new SlugFont(fontData);

        fontCache.set(url, font);

        return font;
    }

    /**
     * Create a SlugFont from an ArrayBuffer (not cached).
     */
    public static fromBuffer(buffer: ArrayBuffer): SlugFont
    {
        const fontData = parseSlugFontFromBuffer(buffer);

        return new SlugFont(fontData);
    }

    /**
     * Measure text dimensions at the given font size.
     */
    public measureText(text: string, fontSize: number): { width: number; height: number }
    {
        const scale = fontSize / this.fontData.unitsPerEm;
        let maxWidth = 0;
        let currentLineWidth = 0;
        let lineCount = 1;
        let prevCodepoint: number | null = null;

        for (const char of text)
        {
            if (char === '\n')
            {
                maxWidth = Math.max(maxWidth, currentLineWidth);
                currentLineWidth = 0;
                lineCount++;
                prevCodepoint = null;
                continue;
            }

            const cp = char.codePointAt(0)!;

            if (prevCodepoint !== null)
            {
                currentLineWidth += this.fontData.getKerning(prevCodepoint, cp) * scale;
            }

            const glyph = this.fontData.glyphs.get(cp);

            if (glyph)
            {
                currentLineWidth += glyph.advanceWidth * scale;
            }
            else
            {
                currentLineWidth += fontSize * 0.3;
            }

            prevCodepoint = cp;
        }

        maxWidth = Math.max(maxWidth, currentLineWidth);
        const lineHeight = (this.fontData.ascender - this.fontData.descender) * scale;

        return {
            width: maxWidth,
            height: lineHeight * lineCount,
        };
    }

    public destroy(): void
    {
        // Remove from cache
        for (const [key, value] of fontCache)
        {
            if (value === this)
            {
                fontCache.delete(key);
                break;
            }
        }
    }
}
