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

    /** True when textures have changed since last consumed */
    public dirty = false;

    private _packed: PackedTextures;
    private _knownGlyphIds: Set<number> = new Set();

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
                this._knownGlyphIds.add(glyph.glyphId);
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
            const glyph = this.fontData.glyphs.get(cp);

            if (glyph && !this._knownGlyphIds.has(glyph.glyphId))
            {
                this._knownGlyphIds.add(glyph.glyphId);
                needsRebuild = true;
            }
        }

        if (!needsRebuild) return false;

        this._rebuild();

        return true;
    }

    /**
     * Ensure glyph IDs are in the atlas, extracting on-demand for unknown IDs.
     * @returns true if the atlas was rebuilt (textures changed)
     */
    public ensureGlyphIds(glyphIds: number[]): boolean
    {
        let needsRebuild = false;

        for (const glyphId of glyphIds)
        {
            if (this._knownGlyphIds.has(glyphId)) continue;

            const glyph = this.fontData.getGlyphByIndex(glyphId);

            if (glyph)
            {
                this._knownGlyphIds.add(glyphId);
                needsRebuild = true;
            }
        }

        if (!needsRebuild) return false;

        this._rebuild();

        return true;
    }

    public getGlyphInfo(glyphId: number): GlyphAtlasEntry | undefined
    {
        return this._packed.atlas.get(glyphId);
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

        for (const glyphId of this._knownGlyphIds)
        {
            const glyph = this.fontData.glyphsById.get(glyphId);

            if (glyph)
            {
                glyphs.push(glyph);
                bandDataList.push(organizeGlyphBands(glyph));
            }
        }

        this._packed = packTextures(glyphs, bandDataList);
        this.dirty = true;
    }
}
