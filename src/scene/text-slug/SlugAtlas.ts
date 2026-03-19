import type { GlyphAtlasEntry, GlyphBandData, SlugFontData, SlugGlyph } from './SlugTypes';
import { organizeGlyphBands } from './utils/bandOrganizer';
import { packTextures, type PackedTextures } from './utils/texturePacker';

/**
 * Dynamic atlas that manages glyph curve and band textures.
 * Supports on-demand glyph addition when new characters are encountered.
 */
export class SlugAtlas
{
    public readonly fontData: SlugFontData;

    private _packed: PackedTextures;
    private _knownCodepoints: Set<number> = new Set();

    constructor(fontData: SlugFontData)
    {
        this.fontData = fontData;

        // Build initial atlas for ASCII printable range (32-126)
        const glyphs: SlugGlyph[] = [];

        for (let cp = 32; cp <= 126; cp++)
        {
            const glyph = fontData.glyphs.get(cp);

            if (glyph)
            {
                glyphs.push(glyph);
                this._knownCodepoints.add(cp);
            }
        }

        const bandDataList = glyphs.map((g) => organizeGlyphBands(g));

        this._packed = packTextures(glyphs, bandDataList);
    }

    /**
     * Ensure all characters in the given text exist in the atlas.
     * @returns true if the atlas was rebuilt (textures changed)
     */
    public ensureCharacters(text: string): boolean
    {
        let needsRebuild = false;

        for (const char of text)
        {
            const cp = char.codePointAt(0)!;

            if (!this._knownCodepoints.has(cp) && this.fontData.glyphs.has(cp))
            {
                this._knownCodepoints.add(cp);
                needsRebuild = true;
            }
        }

        if (!needsRebuild) return false;

        this._rebuild();

        return true;
    }

    public getGlyphInfo(codepoint: number): GlyphAtlasEntry | undefined
    {
        return this._packed.atlas.get(codepoint);
    }

    public getCurveTextureData(): { data: Float32Array; width: number; height: number }
    {
        return {
            data: this._packed.curveData,
            width: this._packed.curveWidth,
            height: this._packed.curveHeight,
        };
    }

    public getBandTextureData(): { data: Uint32Array; width: number; height: number }
    {
        return {
            data: this._packed.bandData,
            width: this._packed.bandWidth,
            height: this._packed.bandHeight,
        };
    }

    private _rebuild(): void
    {
        const glyphs: SlugGlyph[] = [];
        const bandDataList: GlyphBandData[] = [];

        for (const cp of this._knownCodepoints)
        {
            const glyph = this.fontData.glyphs.get(cp);

            if (glyph)
            {
                glyphs.push(glyph);
                bandDataList.push(organizeGlyphBands(glyph));
            }
        }

        this._packed = packTextures(glyphs, bandDataList);
    }
}
