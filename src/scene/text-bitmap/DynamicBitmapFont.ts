import { Color } from '../../color/Color';
import { Rectangle } from '../../maths/shapes/Rectangle';
import { CanvasPool } from '../../rendering/renderers/shared/texture/CanvasPool';
import { ImageSource } from '../../rendering/renderers/shared/texture/sources/ImageSource';
import { Texture } from '../../rendering/renderers/shared/texture/Texture';
import { deprecation, v8_0_0 } from '../../utils/logging/deprecation';
import { Cache } from '../../assets/cache/Cache';
import { CanvasTextMetrics } from '../text/canvas/CanvasTextMetrics';
import { fontStringFromTextStyle } from '../text/canvas/utils/fontStringFromTextStyle';
import { getCanvasFillStyle } from '../text/canvas/utils/getCanvasFillStyle';
import { TextStyle } from '../text/TextStyle';
import { AbstractBitmapFont } from './AbstractBitmapFont';
import { resolveCharacters } from './utils/resolveCharacters';

import type { ICanvasRenderingContext2D } from '../../environment/canvas/ICanvasRenderingContext2D';
import type { CanvasAndContext } from '../../rendering/renderers/shared/texture/CanvasPool';
import type { FontMetrics } from '../text/canvas/CanvasTextMetrics';

export interface DynamicBitmapFontOptions
{
    style: TextStyle
    skipKerning?: boolean
    resolution?: number
    padding?: number
    overrideFill?: boolean
    overrideSize?: boolean
    textureSize?: number
    mipmap?: boolean
}

/**
 * A BitmapFont that generates its glyphs dynamically.
 * @memberof text
 * @ignore
 */
export class DynamicBitmapFont extends AbstractBitmapFont<DynamicBitmapFont>
{
    public static defaultOptions: DynamicBitmapFontOptions = {
        textureSize: 512,
        style: new TextStyle(),
        mipmap: true,
    };
    /**
     * this is a resolution modifier for the font size..
     * texture resolution will also be used to scale texture according to its font size also
     */
    public resolution = 1;
    /** The pages of the font. */
    public override readonly pages: {canvasAndContext?: CanvasAndContext, texture: Texture}[] = [];

    private readonly _padding: number = 0;
    private readonly _measureCache: Record<string, number> = Object.create(null);
    private _currentChars: string[] = [];
    private _currentX = 0;
    private _currentY = 0;
    private _currentPageIndex = -1;
    private readonly _style: TextStyle;
    private readonly _skipKerning: boolean = false;
    private readonly _textureSize: number;
    private readonly _mipmap: boolean;

    /**
     * @param options - The options for the dynamic bitmap font.
     */
    constructor(options: DynamicBitmapFontOptions)
    {
        super();

        const dynamicOptions = { ...DynamicBitmapFont.defaultOptions, ...options };

        this._textureSize = dynamicOptions.textureSize;
        this._mipmap = dynamicOptions.mipmap;

        const style = dynamicOptions.style.clone();

        if (dynamicOptions.overrideFill)
        {
            // assuming no shape fill..
            style._fill.color = 0xffffff;
            style._fill.alpha = 1;
            style._fill.texture = Texture.WHITE;
            style._fill.fill = null;
        }

        this.applyFillAsTint = dynamicOptions.overrideFill;

        const requestedFontSize = style.fontSize;

        // adjust font size to match the base measurement size
        style.fontSize = this.baseMeasurementFontSize;

        const font = fontStringFromTextStyle(style);

        if (dynamicOptions.overrideSize)
        {
            if (style._stroke)
            {
                // we want the stroke to fit the size of the requested text, so we need to scale it
                // accordingly (eg font size 20, with stroke 10 - stroke is 50% of size,
                // as dynamic font is size 100, the stroke should be adjusted to 50 to make it look right)
                style._stroke.width *= this.baseRenderedFontSize / requestedFontSize;
            }
        }
        else
        {
            style.fontSize = this.baseRenderedFontSize = requestedFontSize;
        }

        this._style = style;
        this._skipKerning = dynamicOptions.skipKerning ?? false;
        this.resolution = dynamicOptions.resolution ?? 1;
        this._padding = dynamicOptions.padding ?? 4;

        (this.fontMetrics as FontMetrics) = CanvasTextMetrics.measureFont(font);
        (this.lineHeight as number) = style.lineHeight || this.fontMetrics.fontSize || style.fontSize;
    }

    public ensureCharacters(chars: string): void
    {
        const charList = resolveCharacters(chars)
            .filter((char) => !this._currentChars.includes(char))
            .filter((char, index, self) => self.indexOf(char) === index);
        // filter returns..

        if (!charList.length) return;

        this._currentChars = [...this._currentChars, ...charList];

        let pageData;

        if (this._currentPageIndex === -1)
        {
            pageData = this._nextPage();
        }
        else
        {
            pageData = this.pages[this._currentPageIndex];
        }

        let { canvas, context } = pageData.canvasAndContext;
        let textureSource = pageData.texture.source;

        const style = this._style;

        let currentX = this._currentX;
        let currentY = this._currentY;

        const fontScale = this.baseRenderedFontSize / this.baseMeasurementFontSize;
        const padding = this._padding * fontScale;

        let maxCharHeight = 0;
        let skipTexture = false;

        const maxTextureWidth = canvas.width / this.resolution;
        const maxTextureHeight = canvas.height / this.resolution;

        for (let i = 0; i < charList.length; i++)
        {
            const char = charList[i];

            // Use OpenType-enabled measurement for individual character width
            const charWidth = CanvasTextMetrics.measureTextWidth(char, 0, context);
            
            // Also get metrics for height and other properties
            const metrics = CanvasTextMetrics.measureText(char, style, canvas, false);

            // override the line height.. we want this to be the glyps height
            // not the user specified one.
            metrics.lineHeight = metrics.height;

            // Use the OpenType width for more precise measurements
            const width = charWidth * fontScale;
            // This is ugly - but italics are given more space so they don't overlap
            const textureGlyphWidth = Math.ceil((style.fontStyle === 'italic' ? 2 : 1) * width);

            const height = (metrics.height) * fontScale;

            const paddedWidth = textureGlyphWidth + (padding * 2);
            const paddedHeight = height + (padding * 2);

            skipTexture = false;
            // don't let empty characters count towards the maxCharHeight
            if (char !== '\n' && char !== '\r' && char !== '\t' && char !== ' ')
            {
                skipTexture = true;
                maxCharHeight = Math.ceil(Math.max(paddedHeight, maxCharHeight));// / 1.5;
            }

            if (currentX + paddedWidth > maxTextureWidth)
            {
                currentY += maxCharHeight;

                // reset the line x and height..
                maxCharHeight = paddedHeight;
                currentX = 0;

                if (currentY + maxCharHeight > maxTextureHeight)
                {
                    textureSource.update();

                    const pageData = this._nextPage();

                    canvas = pageData.canvasAndContext.canvas;
                    context = pageData.canvasAndContext.context;
                    textureSource = pageData.texture.source;

                    currentY = 0;
                }
            }

            // Use the unscaled charWidth for xAdvance to avoid precision loss
            const xAdvance = charWidth
                - (style.dropShadow?.distance ?? 0)
                - (style._stroke?.width ?? 0);

            // This is in coord space of the measurements.. not the texture
            this.chars[char] = {
                id: char.codePointAt(0),
                xOffset: -this._padding,
                yOffset: -this._padding,
                xAdvance,
                kerning: {},
            };

            if (skipTexture)
            {
                this._drawGlyph(
                    context,
                    metrics,
                    currentX + padding,
                    currentY + padding,
                    fontScale,
                    style,
                );

                const px = textureSource.width * fontScale;
                const py = textureSource.height * fontScale;

                const frame = new Rectangle(
                    ((currentX) / px) * textureSource.width,
                    ((currentY) / py) * textureSource.height,
                    ((paddedWidth) / px) * textureSource.width,
                    ((paddedHeight) / py) * textureSource.height,
                );

                this.chars[char].texture = new Texture({
                    source: textureSource,
                    frame,
                });

                currentX += Math.ceil(paddedWidth);
            }

            // now add it to the font data..
        }

        textureSource.update();

        this._currentX = currentX;
        this._currentY = currentY;

        // now apply kerning..
        this._skipKerning && this._applyKerning(charList, context);
    }

    /**
     * @deprecated since 8.0.0
     * The map of base page textures (i.e., sheets of glyphs).
     */
    public override get pageTextures(): DynamicBitmapFont['pages']
    {
        // #if _DEBUG
        deprecation(v8_0_0, 'BitmapFont.pageTextures is deprecated, please use BitmapFont.pages instead.');
        // #endif

        return this.pages;
    }

    private _applyKerning(newChars: string[], context: ICanvasRenderingContext2D): void
    {
        const measureCache = this._measureCache;

        // Use OpenType-enabled measurement for more accurate kerning calculations
        for (let i = 0; i < newChars.length; i++)
        {
            const first = newChars[i];

            for (let j = 0; j < this._currentChars.length; j++)
            {
                // first go through new char being first
                const second = this._currentChars[j];

                let c1 = measureCache[first];

                if (!c1) c1 = measureCache[first] = CanvasTextMetrics.measureTextWidth(first, 0, context);

                let c2 = measureCache[second];

                if (!c2) c2 = measureCache[second] = CanvasTextMetrics.measureTextWidth(second, 0, context);

                let total = CanvasTextMetrics.measureTextWidth(first + second, 0, context);
                let amount = total - (c1 + c2);

                if (amount)
                {
                    this.chars[first].kerning[second] = amount;
                }

                // then go through new char being second
                total = CanvasTextMetrics.measureTextWidth(first + second, 0, context);
                amount = total - (c1 + c2);

                if (amount)
                {
                    this.chars[second].kerning[first] = amount;
                }
            }
        }
    }

    private _nextPage(): {canvasAndContext: CanvasAndContext, texture: Texture}
    {
        this._currentPageIndex++;

        const textureResolution = this.resolution;
        const canvasAndContext = CanvasPool.getOptimalCanvasAndContext(
            this._textureSize,
            this._textureSize,
            textureResolution
        );

        this._setupContext(canvasAndContext.context, this._style, textureResolution);

        const resolution = textureResolution * (this.baseRenderedFontSize / this.baseMeasurementFontSize);
        const texture = new Texture({
            source: new ImageSource({
                resource: canvasAndContext.canvas,
                resolution,
                alphaMode: 'premultiply-alpha-on-upload',
                autoGenerateMipmaps: this._mipmap,
            }),

        });

        const pageData = {
            canvasAndContext,
            texture,
        };

        this.pages[this._currentPageIndex] = pageData;

        return pageData;
    }

    // canvas style!
    private _setupContext(context: ICanvasRenderingContext2D, style: TextStyle, resolution: number): void
    {
        // Set the font to the base measurement size for consistent OpenType lookup
        const tempFontSize = style.fontSize;
        style.fontSize = this.baseMeasurementFontSize;
        
        context.scale(resolution, resolution);
        context.font = fontStringFromTextStyle(style);
        context.textBaseline = style.textBaseline;

        // Restore the original font size
        style.fontSize = tempFontSize;

        const stroke = style._stroke;
        const strokeThickness = stroke?.width ?? 0;

        if (stroke)
        {
            context.lineWidth = strokeThickness;
            context.lineJoin = stroke.join;
            context.miterLimit = stroke.miterLimit;

            // TODO prolly cache this??
            context.strokeStyle = getCanvasFillStyle(stroke, context);
        }

        if (style._fill)
        {
            // set canvas text styles
            context.fillStyle = getCanvasFillStyle(style._fill, context);
        }

        if (style.dropShadow)
        {
            const shadowOptions = style.dropShadow;
            const rgb = Color.shared.setValue(shadowOptions.color).toArray();

            const dropShadowBlur = shadowOptions.blur * resolution;
            const dropShadowDistance = shadowOptions.distance * resolution;

            context.shadowColor = `rgba(${rgb[0] * 255},${rgb[1] * 255},${rgb[2] * 255},${shadowOptions.alpha})`;
            context.shadowBlur = dropShadowBlur;
            context.shadowOffsetX = Math.cos(shadowOptions.angle) * dropShadowDistance;
            context.shadowOffsetY = Math.sin(shadowOptions.angle) * dropShadowDistance;
        }
        else
        {
            context.shadowColor = 'black';
            context.shadowBlur = 0;
            context.shadowOffsetX = 0;
            context.shadowOffsetY = 0;
        }
    }

    private _drawGlyph(
        context: ICanvasRenderingContext2D,
        metrics: CanvasTextMetrics,
        x: number,
        y: number,
        fontScale: number,
        style: TextStyle
    ): void
    {
        const char = metrics.text;
        const fontProperties = metrics.fontProperties;
        const stroke = style._stroke;

        const strokeThickness = (stroke?.width ?? 0) * fontScale;

        const tx = x + (strokeThickness / 2);
        const ty = y - (strokeThickness / 2);

        const descent = fontProperties.descent * fontScale;
        const lineHeight = metrics.lineHeight * fontScale;

        // Calculate the baseline position for drawing
        const baselineY = ty + lineHeight - descent;
        
        // Try to use OpenType font for more accurate glyph rendering
        const openTypeFont = this._getOpenTypeFont();
        
        if (openTypeFont)
        {
            // Use OpenType.js for precise glyph rendering
            this._drawGlyphWithOpenType(
                context,
                char,
                tx,
                baselineY,
                fontScale,
                style,
                openTypeFont,
                strokeThickness
            );
        }
        else
        {
            // Fallback to canvas text rendering
            this._drawGlyphWithCanvas(
                context,
                char,
                tx,
                baselineY,
                style,
                strokeThickness
            );
        }
    }

    /**
     * Gets the OpenType font for this dynamic bitmap font
     * @returns OpenType font object or null if not available
     */
    private _getOpenTypeFont(): any | null
    {
        try
        {
            // Extract font family from the style
            const fontFamily = this._style.fontFamily;
            
            // Handle font family arrays (take the first one)
            const family = Array.isArray(fontFamily) ? fontFamily[0] : fontFamily;
            
            // Remove quotes and get clean family name
            const cleanFamily = family.replace(/['"]/g, '');
            
            const cacheKey = `${cleanFamily}-opentype`;
            const openTypeFontData = Cache.get(cacheKey);
            
            if (openTypeFontData?.font)
            {
                return openTypeFontData.font;
            }
            
            return null;
        }
        catch (error)
        {
            console.warn('Failed to get OpenType font:', error);
            return null;
        }
    }

    /**
     * Draws a glyph using OpenType.js methods
     */
    private _drawGlyphWithOpenType(
        context: ICanvasRenderingContext2D,
        char: string,
        x: number,
        y: number,
        fontScale: number,
        style: TextStyle,
        openTypeFont: any,
        strokeThickness: number
    ): void
    {
        // Calculate the actual font size for OpenType rendering
        // We need to use the base measurement font size
        const fontSize = this.baseMeasurementFontSize;
        
        // Save the current context state
        context.save();
        
        // Scale the context to match our font scale
        context.scale(fontScale, fontScale);
        
        // Adjust coordinates for the scaled context
        const scaledX = x / fontScale;
        const scaledY = y / fontScale;
        
        try
        {
            // Draw stroke if needed
            if (style._stroke && strokeThickness > 0)
            {
                // For stroke, we need to get the path and stroke it manually
                const path = openTypeFont.getPath(char, scaledX, scaledY, fontSize, {
                    kerning: true,
                    hinting: false
                });
                
                // Set up stroke properties
                context.lineWidth = strokeThickness / fontScale;
                context.lineJoin = style._stroke.join || 'round';
                context.miterLimit = style._stroke.miterLimit || 10;
                context.strokeStyle = context.strokeStyle; // Use existing stroke style
                
                // Convert OpenType path to canvas path and stroke
                this._drawOpenTypePath(context, path, true, false);
            }
            
            // Draw fill if needed
            if (style._fill)
            {
                const path = openTypeFont.getPath(char, scaledX, scaledY, fontSize, {
                    kerning: true,
                    hinting: false
                });
                
                // Convert OpenType path to canvas path and fill
                this._drawOpenTypePath(context, path, false, true);
            }
        }
        catch (error)
        {
            console.warn('OpenType glyph rendering failed, falling back to canvas:', error);
            
            // Restore context and fallback to canvas rendering
            context.restore();
            this._drawGlyphWithCanvas(context, char, x, y, style, strokeThickness);
            return;
        }
        
        // Restore the context state
        context.restore();
    }

    /**
     * Converts an OpenType path to canvas path commands and draws it
     */
    private _drawOpenTypePath(
        context: ICanvasRenderingContext2D,
        openTypePath: any,
        shouldStroke: boolean,
        shouldFill: boolean
    ): void
    {
        if (!openTypePath.commands || openTypePath.commands.length === 0)
        {
            return;
        }
        
        context.beginPath();
        
        for (const command of openTypePath.commands)
        {
            switch (command.type)
            {
                case 'M': // Move to
                    context.moveTo(command.x, command.y);
                    break;
                case 'L': // Line to
                    context.lineTo(command.x, command.y);
                    break;
                case 'C': // Cubic Bezier curve
                    context.bezierCurveTo(
                        command.x1, command.y1,
                        command.x2, command.y2,
                        command.x, command.y
                    );
                    break;
                case 'Q': // Quadratic Bezier curve
                    context.quadraticCurveTo(
                        command.x1, command.y1,
                        command.x, command.y
                    );
                    break;
                case 'Z': // Close path
                    context.closePath();
                    break;
            }
        }
        
        if (shouldStroke)
        {
            context.stroke();
        }
        
        if (shouldFill)
        {
            context.fill();
        }
    }

    /**
     * Fallback method to draw glyph using canvas text methods
     */
    private _drawGlyphWithCanvas(
        context: ICanvasRenderingContext2D,
        char: string,
        x: number,
        y: number,
        style: TextStyle,
        strokeThickness: number
    ): void
    {
        if (style._stroke && strokeThickness > 0)
        {
            context.strokeText(char, x, y);
        }

        if (style._fill)
        {
            context.fillText(char, x, y);
        }
    }

    /**
     * Debug method to test OpenType glyph rendering for specific characters
     * @param chars - Characters to test
     */
    public debugOpenTypeGlyphRendering(chars: string): void
    {
        console.log('=== OpenType Glyph Rendering Debug ===');
        
        const openTypeFont = this._getOpenTypeFont();
        
        if (!openTypeFont)
        {
            console.log('No OpenType font available for debugging');
            return;
        }
        
        console.log('OpenType font found:', {
            familyName: openTypeFont.familyName,
            unitsPerEm: openTypeFont.unitsPerEm,
            ascender: openTypeFont.ascender,
            descender: openTypeFont.descender
        });
        
        // Test if we can get paths for each character
        for (const char of chars)
        {
            console.log(`\n--- Testing character: "${char}" ---`);
            
            try
            {
                const glyph = openTypeFont.charToGlyph(char);
                if (glyph)
                {
                    console.log('Glyph found:', {
                        name: glyph.name,
                        unicode: glyph.unicode,
                        advanceWidth: glyph.advanceWidth,
                        leftSideBearing: glyph.leftSideBearing
                    });
                    
                    // Test getting a path
                    const path = openTypeFont.getPath(char, 0, 0, this.baseMeasurementFontSize);
                    console.log('Path generated:', {
                        commandCount: path.commands?.length || 0,
                        fill: path.fill,
                        stroke: path.stroke
                    });
                }
                else
                {
                    console.warn(`No glyph found for character: "${char}"`);
                }
            }
            catch (error)
            {
                console.error(`Error testing character "${char}":`, error);
            }
        }
        
        console.log('=== End OpenType Glyph Debug ===');
    }

    public override destroy(): void
    {
        super.destroy();

        for (let i = 0; i < this.pages.length; i++)
        {
            const { canvasAndContext, texture } = this.pages[i];

            CanvasPool.returnCanvasAndContext(canvasAndContext);
            texture.destroy(true);
        }

        (this.pages as null) = null;
    }
}
