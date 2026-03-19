import { ObservablePoint } from '../../maths/point/ObservablePoint';
import { ViewContainer } from '../view/ViewContainer';

import type { PointData } from '../../maths/point/PointData';
import type { View } from '../../rendering/renderers/shared/view/View';
import type { ContainerOptions } from '../container/Container';
import type { DestroyOptions } from '../container/destroyTypes';
import type { GPUData } from '../view/ViewContainer';
import type { SlugFont } from './SlugFont';

/** GPU data stored per-renderer for SlugText */
export class SlugTextGpuData implements GPUData
{
    /** The proxy Mesh managed by the pipe */
    public mesh: any = null;
    /** Whether textures need re-upload */
    public texturesDirty = true;

    public destroy(): void
    {
        if (this.mesh)
        {
            this.mesh.destroy();
            this.mesh = null;
        }
    }
}

/**
 * Options for creating a SlugText instance.
 */
export interface SlugTextOptions extends ContainerOptions
{
    /** The text content to display */
    text?: string;
    /** The SlugFont to render with */
    font: SlugFont;
    /** Font size in pixels */
    fontSize?: number;
    /** Text color as [r, g, b, a] normalized */
    color?: [number, number, number, number];
    /** The anchor point of the text (0-1 range) */
    anchor?: PointData;
    /** Extra spacing between characters in pixels */
    letterSpacing?: number;
    /** Line height in pixels (overrides font default) */
    lineHeight?: number;
    /** Text alignment */
    align?: 'left' | 'center' | 'right';
    /** Whether to enable word wrapping */
    wordWrap?: boolean;
    /** Maximum width for word wrapping in pixels */
    wordWrapWidth?: number;
}

// eslint-disable-next-line requireExport/require-export-jsdoc, requireMemberAPI/require-member-api-doc
export interface SlugText extends ViewContainer<SlugTextGpuData> {}

/**
 * A display object that renders text using the Slug algorithm,
 * providing resolution-independent text rendering directly from
 * quadratic Bezier curves on the GPU.
 */
export class SlugText extends ViewContainer<SlugTextGpuData> implements View
{
    /** @internal */
    public override readonly renderPipeId = 'slugText';

    /** @internal */
    public _didTextUpdate = true;

    /** @internal */
    public _font: SlugFont;
    /** @internal */
    public _fontSize: number;
    /** @internal */
    public _color: [number, number, number, number];
    /** @internal */
    public _anchor: ObservablePoint;
    /** @internal */
    public _letterSpacing: number;
    /** @internal */
    public _lineHeight: number | undefined;
    /** @internal */
    public _align: 'left' | 'center' | 'right';
    /** @internal */
    public _wordWrap: boolean;
    /** @internal */
    public _wordWrapWidth: number;

    /** @internal */
    public _text: string;

    constructor(options: SlugTextOptions)
    {
        const { text, font, fontSize, color, anchor, letterSpacing, lineHeight, align, wordWrap, wordWrapWidth, ...rest } = options;

        super({
            label: 'SlugText',
            ...rest,
        });

        this.allowChildren = false;

        this._text = text ?? '';
        this._font = font;
        this._fontSize = fontSize ?? 24;
        this._color = color ?? [1, 1, 1, 1];
        this._letterSpacing = letterSpacing ?? 0;
        this._lineHeight = lineHeight;
        this._align = align ?? 'left';
        this._wordWrap = wordWrap ?? false;
        this._wordWrapWidth = wordWrapWidth ?? 0;

        this._anchor = new ObservablePoint(
            {
                _onUpdate: () =>
                {
                    this.onViewUpdate();
                },
            },
        );

        if (anchor)
        {
            this._anchor.set(anchor.x, anchor.y);
        }
    }

    /** The text content to display. */
    get text(): string
    {
        return this._text;
    }

    set text(value: string)
    {
        value = String(value ?? '');
        if (this._text === value) return;
        this._text = value;
        this._didTextUpdate = true;
        this.onViewUpdate();
    }

    /** The SlugFont used for rendering. */
    get font(): SlugFont
    {
        return this._font;
    }

    set font(value: SlugFont)
    {
        if (this._font === value) return;
        this._font = value;
        this._didTextUpdate = true;
        this.onViewUpdate();
    }

    /** The font size in pixels. */
    get fontSize(): number
    {
        return this._fontSize;
    }

    set fontSize(value: number)
    {
        if (this._fontSize === value) return;
        this._fontSize = value;
        this._didTextUpdate = true;
        this.onViewUpdate();
    }

    /** The text color as [r, g, b, a] normalized values. */
    get color(): [number, number, number, number]
    {
        return this._color;
    }

    set color(value: [number, number, number, number])
    {
        this._color = value;
        this._didTextUpdate = true;
        this.onViewUpdate();
    }

    /** The anchor point (0-1 range). */
    get anchor(): ObservablePoint
    {
        return this._anchor;
    }

    set anchor(value: PointData)
    {
        this._anchor.copyFrom(value);
    }

    /** Extra spacing between characters in pixels. */
    get letterSpacing(): number
    {
        return this._letterSpacing;
    }

    set letterSpacing(value: number)
    {
        if (this._letterSpacing === value) return;
        this._letterSpacing = value;
        this._didTextUpdate = true;
        this.onViewUpdate();
    }

    /** Text alignment ('left', 'center', 'right'). */
    get align(): 'left' | 'center' | 'right'
    {
        return this._align;
    }

    set align(value: 'left' | 'center' | 'right')
    {
        if (this._align === value) return;
        this._align = value;
        this._didTextUpdate = true;
        this.onViewUpdate();
    }

    /** Whether word wrapping is enabled. */
    get wordWrap(): boolean
    {
        return this._wordWrap;
    }

    set wordWrap(value: boolean)
    {
        if (this._wordWrap === value) return;
        this._wordWrap = value;
        this._didTextUpdate = true;
        this.onViewUpdate();
    }

    /** Maximum width for word wrapping in pixels. */
    get wordWrapWidth(): number
    {
        return this._wordWrapWidth;
    }

    set wordWrapWidth(value: number)
    {
        if (this._wordWrapWidth === value) return;
        this._wordWrapWidth = value;
        this._didTextUpdate = true;
        this.onViewUpdate();
    }

    public get batched(): boolean
    {
        return false;
    }

    protected updateBounds(): void
    {
        const bounds = this._bounds;
        const measurement = this._font.measureText(this._text, this._fontSize);

        const anchor = this._anchor;

        bounds.minX = -anchor._x * measurement.width;
        bounds.maxX = bounds.minX + measurement.width;
        bounds.minY = -anchor._y * measurement.height;
        bounds.maxY = bounds.minY + measurement.height;
    }

    public override destroy(options?: DestroyOptions): void
    {
        super.destroy(options);

        this._font = null as any;
        this._anchor = null as any;
    }
}
