import { ExtensionType } from '../../extensions/Extensions';
import { BufferImageSource } from '../../rendering/renderers/shared/texture/sources/BufferImageSource';
import { Mesh } from '../mesh/shared/Mesh';
import { State } from '../../rendering/renderers/shared/state/State';
import { SlugShader } from './SlugShader';
import { SlugTextGpuData } from './SlugText';
import { buildSlugGeometry } from './SlugTextLayout';

import type { InstructionSet } from '../../rendering/renderers/shared/instructions/InstructionSet';
import type { RenderPipe } from '../../rendering/renderers/shared/instructions/RenderPipe';
import type { Renderable } from '../../rendering/renderers/shared/Renderable';
import type { Renderer } from '../../rendering/renderers/types';
import type { SlugText } from './SlugText';

/** @internal */
export class SlugTextPipe implements RenderPipe<SlugText>
{
    /** @ignore */
    public static extension = {
        type: [
            ExtensionType.WebGLPipes,
            ExtensionType.WebGPUPipes,
        ],
        name: 'slugText',
    } as const;

    private _renderer: Renderer;

    constructor(renderer: Renderer)
    {
        this._renderer = renderer;
    }

    public validateRenderable(slugText: SlugText): boolean
    {
        const gpuData = this._getGpuData(slugText);

        if (!gpuData.mesh) return true;

        return this._renderer.renderPipes.mesh.validateRenderable(gpuData.mesh);
    }

    public addRenderable(slugText: SlugText, instructionSet: InstructionSet): void
    {
        const gpuData = this._getGpuData(slugText);

        if (slugText._didTextUpdate)
        {
            slugText._didTextUpdate = false;
            this._rebuild(slugText, gpuData);
        }

        this._syncProxy(slugText, gpuData.mesh);
        this._updateViewport(gpuData);

        this._renderer.renderPipes.mesh.addRenderable(gpuData.mesh, instructionSet);
    }

    public updateRenderable(slugText: SlugText): void
    {
        const gpuData = this._getGpuData(slugText);

        this._syncProxy(slugText, gpuData.mesh);
        this._updateViewport(gpuData);

        this._renderer.renderPipes.mesh.updateRenderable(gpuData.mesh);
    }

    public destroyRenderable(slugText: SlugText): void
    {
        const gpuData = slugText._gpuData[this._renderer.uid];

        if (gpuData)
        {
            gpuData.destroy();
            slugText._gpuData[this._renderer.uid] = null as any;
        }
    }

    private _getGpuData(slugText: SlugText): SlugTextGpuData
    {
        return slugText._gpuData[this._renderer.uid] || this._initGpuData(slugText);
    }

    private _initGpuData(slugText: SlugText): SlugTextGpuData
    {
        const gpuData = new SlugTextGpuData();

        slugText._gpuData[this._renderer.uid] = gpuData;

        this._rebuild(slugText, gpuData);

        return gpuData;
    }

    private _rebuild(slugText: SlugText, gpuData: SlugTextGpuData): void
    {
        const font = slugText._font;
        const atlas = font.atlas;

        // Build geometry (shaping + atlas ensuring happens inside buildSlugGeometry,
        // which may call atlas.ensureGlyphIds and bump atlas.version)
        const geometry = buildSlugGeometry(font, {
            text: slugText._text,
            fontSize: slugText._fontSize,
            color: slugText._color,
            letterSpacing: slugText._letterSpacing,
            lineHeight: slugText._lineHeight,
            align: slugText._align,
            wordWrap: slugText._wordWrap,
            wordWrapWidth: slugText._wordWrapWidth,
        });

        if (gpuData.mesh)
        {
            // Update existing mesh
            gpuData.mesh.geometry.destroy();
            gpuData.mesh.geometry = geometry;

            // Use per-instance version tracking instead of shared dirty flag
            if (gpuData.atlasVersion !== atlas.version)
            {
                this._updateTextures(slugText, gpuData);
                gpuData.atlasVersion = atlas.version;
            }
        }
        else
        {
            // Create new mesh with shader
            const curveTexData = atlas.getCurveTextureData();
            const bandTexData = atlas.getBandTextureData();

            const curveSource = new BufferImageSource({
                resource: curveTexData.data,
                width: curveTexData.width,
                height: curveTexData.height,
                alphaMode: 'no-premultiply-alpha',
                scaleMode: 'nearest',
            });

            const bandSource = new BufferImageSource({
                resource: bandTexData.data,
                width: bandTexData.width,
                height: bandTexData.height,
                alphaMode: 'no-premultiply-alpha',
                scaleMode: 'nearest',
            });

            const shader = new SlugShader({
                curveTexture: curveSource,
                bandTexture: bandSource,
            });

            const state = State.for2d();

            state.blendMode = 'normal';

            const mesh = new Mesh({
                geometry,
                shader,
                state,
            });

            gpuData.mesh = mesh;
            gpuData.atlasVersion = atlas.version;
        }
    }

    private _updateTextures(slugText: SlugText, gpuData: SlugTextGpuData): void
    {
        const atlas = slugText._font.atlas;
        const shader = gpuData.mesh.shader as SlugShader;

        const curveTexData = atlas.getCurveTextureData();
        const bandTexData = atlas.getBandTextureData();

        // Update existing texture sources in-place instead of creating new ones
        const curveSource = shader.resources.uCurveTexture as BufferImageSource;
        const bandSource = shader.resources.uBandTexture as BufferImageSource;

        curveSource.resource = curveTexData.data;
        curveSource.resize(curveTexData.width, curveTexData.height);
        curveSource.update();

        bandSource.resource = bandTexData.data;
        bandSource.resize(bandTexData.width, bandTexData.height);
        bandSource.update();
    }

    private _syncProxy(container: Renderable, proxy: Renderable): void
    {
        proxy.groupTransform = container.groupTransform;
        proxy.groupColorAlpha = container.groupColorAlpha;
        proxy.groupColor = container.groupColor;
        proxy.groupBlendMode = container.groupBlendMode;
        proxy.globalDisplayStatus = container.globalDisplayStatus;
        proxy.localDisplayStatus = container.localDisplayStatus;
        proxy.groupAlpha = container.groupAlpha;
        proxy._roundPixels = container._roundPixels;
    }

    private _updateViewport(gpuData: SlugTextGpuData): void
    {
        const shader = gpuData.mesh?.shader as SlugShader;

        if (shader)
        {
            const renderer = this._renderer;

            shader.resources.slugUniforms.uniforms.uViewport[0] = renderer.width;
            shader.resources.slugUniforms.uniforms.uViewport[1] = renderer.height;
        }
    }

    public destroy(): void
    {
        this._renderer = null as any;
    }
}
