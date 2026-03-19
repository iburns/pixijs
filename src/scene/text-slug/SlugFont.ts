import { SlugAtlas } from './SlugAtlas';
import { HarfBuzzShaper } from './utils/harfbuzzShaper';

import type { SlugFontData } from './SlugTypes';
import type { ShapedGlyph } from './utils/harfbuzzShaper';
import { parseSlugFont, parseSlugFontFromBuffer } from './utils/fontParser';

const fontCache = new Map<string, SlugFont>();

/**
 * A Slug font with parsed glyph data and a dynamic atlas.
 */
export class SlugFont
{
    public readonly fontData: SlugFontData;
    public readonly atlas: SlugAtlas;

    private _shaper: HarfBuzzShaper | null = null;
    private _shaperReady: Promise<void> | null = null;

    constructor(fontData: SlugFontData)
    {
        this.fontData = fontData;
        this.atlas = new SlugAtlas(fontData);

        this._shaperReady = this._initShaper();
    }

    private async _initShaper(): Promise<void>
    {
        this._shaper = await HarfBuzzShaper.create(this.fontData.rawBuffer);
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

        await font._shaperReady;

        fontCache.set(url, font);

        return font;
    }

    /**
     * Create a SlugFont from an ArrayBuffer (not cached).
     */
    public static async fromBuffer(buffer: ArrayBuffer): Promise<SlugFont>
    {
        const fontData = parseSlugFontFromBuffer(buffer);
        const font = new SlugFont(fontData);

        await font._shaperReady;

        return font;
    }

    /**
     * Shape text using HarfBuzz.
     */
    public shape(text: string): ShapedGlyph[]
    {
        if (!this._shaper)
        {
            throw new Error('[SlugFont] HarfBuzz shaper not initialized. Ensure font is loaded via `await SlugFont.from()` or `await SlugFont.fromBuffer()`.');
        }

        return this._shaper.shape(text);
    }

    /**
     * Measure text dimensions at the given font size.
     */
    public measureText(
        text: string,
        fontSize: number,
        options?: { lineHeight?: number; letterSpacing?: number },
    ): { width: number; height: number }
    {
        const scale = fontSize / this.fontData.unitsPerEm;
        const defaultLineHeight = (this.fontData.ascender - this.fontData.descender) * scale;
        const effectiveLineHeight = options?.lineHeight ?? defaultLineHeight;
        const letterSpacing = options?.letterSpacing ?? 0;
        let maxWidth = 0;
        let lineCount = 1;

        const lines = text.split('\n');

        lineCount = lines.length;

        for (const line of lines)
        {
            let lineWidth: number;

            if (this._shaper)
            {
                const shaped = this._shaper.shape(line);

                lineWidth = 0;
                let prevCluster = -1;

                for (const sg of shaped)
                {
                    lineWidth += sg.xAdvance * scale;

                    if (prevCluster !== -1 && sg.cluster !== prevCluster)
                    {
                        lineWidth += letterSpacing;
                    }
                    prevCluster = sg.cluster;
                }
            }
            else
            {
                lineWidth = 0;
                let prevCodepoint: number | null = null;
                let charCount = 0;

                for (const char of line)
                {
                    const cp = char.codePointAt(0)!;

                    if (prevCodepoint !== null)
                    {
                        lineWidth += this.fontData.getKerning(prevCodepoint, cp) * scale;
                    }

                    const glyph = this.fontData.glyphs.get(cp);

                    if (glyph)
                    {
                        lineWidth += glyph.advanceWidth * scale;
                    }
                    else
                    {
                        lineWidth += fontSize * 0.3;
                    }

                    prevCodepoint = cp;
                    charCount++;
                }

                if (charCount > 1) lineWidth += letterSpacing * (charCount - 1);
            }

            maxWidth = Math.max(maxWidth, lineWidth);
        }

        return {
            width: maxWidth,
            height: defaultLineHeight + ((lineCount - 1) * effectiveLineHeight),
        };
    }

    public destroy(): void
    {
        if (this._shaper)
        {
            this._shaper.destroy();
            this._shaper = null;
        }

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
