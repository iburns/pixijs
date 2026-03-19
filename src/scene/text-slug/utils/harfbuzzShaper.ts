export interface ShapedGlyph
{
    glyphId: number;
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
    cluster: number;
}

let hbApi: any = null;
let hbInitPromise: Promise<any> | null = null;
let _harfbuzzWasmUrl: string | undefined;

/**
 * Set the URL where `hb.wasm` can be fetched from.
 * The file is located at `node_modules/harfbuzzjs/hb.wasm` in the package.
 *
 * Must be called before any SlugFont is loaded.
 *
 * @example
 * ```ts
 * setHarfbuzzWasmUrl('/hb.wasm');
 * ```
 */
export function setHarfbuzzWasmUrl(url: string): void
{
    _harfbuzzWasmUrl = url;
}

/**
 * Initialize HarfBuzz by loading the WASM module and creating the JS bindings.
 *
 * Uses the harfbuzzjs package:
 * - `hb.js` (Emscripten glue) loads the WASM and returns the module
 * - `hbjs.js` wraps the module into a friendly JS API
 */
export async function initHarfBuzz(): Promise<any>
{
    if (hbApi) return hbApi;

    if (!hbInitPromise)
    {
        hbInitPromise = (async () =>
        {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const createHarfBuzz = (await import('harfbuzzjs/hb.js')).default;
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const hbjs = (await import('harfbuzzjs/hbjs.js')).default;

            // The Emscripten module uses locateFile to resolve hb.wasm.
            // By default it resolves relative to the bundled script URL,
            // which is wrong when bundled. We override it here.
            const hbModule = await createHarfBuzz({
                locateFile: (file: string) =>
                {
                    if (file === 'hb.wasm' && _harfbuzzWasmUrl)
                    {
                        return _harfbuzzWasmUrl;
                    }

                    return file;
                },
            });

            hbApi = hbjs(hbModule);

            return hbApi;
        })();
    }

    return hbInitPromise;
}

export class HarfBuzzShaper
{
    private _hb: any;
    private _blob: any;
    private _face: any;
    private _font: any;

    private constructor(hb: any, fontBuffer: ArrayBuffer)
    {
        this._hb = hb;
        this._blob = hb.createBlob(fontBuffer);
        this._face = hb.createFace(this._blob, 0);
        this._font = hb.createFont(this._face);
    }

    public static async create(fontBuffer: ArrayBuffer): Promise<HarfBuzzShaper>
    {
        const hb = await initHarfBuzz();

        return new HarfBuzzShaper(hb, fontBuffer);
    }

    public shape(text: string): ShapedGlyph[]
    {
        if (!text) return [];

        const hb = this._hb;
        const buffer = hb.createBuffer();

        buffer.addText(text);
        buffer.guessSegmentProperties();
        hb.shape(this._font, buffer);

        const result: ShapedGlyph[] = [];
        const json = buffer.json(this._font);

        for (const info of json)
        {
            result.push({
                glyphId: info.g,
                xAdvance: info.ax,
                yAdvance: info.ay,
                xOffset: info.dx,
                yOffset: info.dy,
                cluster: info.cl,
            });
        }

        buffer.destroy();

        return result;
    }

    public destroy(): void
    {
        if (this._font) this._font.destroy();
        if (this._face) this._face.destroy();
        if (this._blob) this._blob.destroy();
        this._font = null;
        this._face = null;
        this._blob = null;
    }
}
