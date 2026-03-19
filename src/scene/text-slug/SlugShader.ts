import { GlProgram } from '../../rendering/renderers/gl/shader/GlProgram';
import { GpuProgram } from '../../rendering/renderers/gpu/shader/GpuProgram';
import { Shader } from '../../rendering/renderers/shared/shader/Shader';
import fragment from './shader-bits/slug.frag';
import vertex from './shader-bits/slug.vert';
import fragWgsl from './shader-bits/slug-frag.wgsl';
import vertWgsl from './shader-bits/slug-vert.wgsl';

import type { BufferImageSource } from '../../rendering/renderers/shared/texture/sources/BufferImageSource';

/**
 * Custom Shader wrapping the Slug vertex/fragment programs for both WebGL2 and WebGPU.
 */
export class SlugShader extends Shader
{
    constructor(options: {
        curveTexture: BufferImageSource;
        bandTexture: BufferImageSource;
    })
    {
        const glProgram = GlProgram.from({
            vertex,
            fragment,
            name: 'slug-text',
            preferredFragmentPrecision: 'highp',
            preferredVertexPrecision: 'highp',
        });

        const gpuProgram = GpuProgram.from({
            vertex: {
                source: vertWgsl,
                entryPoint: 'main',
            },
            fragment: {
                source: fragWgsl,
                entryPoint: 'main',
            },
            name: 'slug-text',
        });

        super({
            glProgram,
            gpuProgram,
            resources: {
                // Textures
                uCurveTexture: options.curveTexture,
                uCurveTextureSampler: options.curveTexture.style,
                uBandTexture: options.bandTexture,
                uBandTextureSampler: options.bandTexture.style,
                // Custom uniforms
                slugUniforms: {
                    uViewport: { value: [800, 600], type: 'vec2<f32>' },
                    uDebugMode: { value: 0, type: 'i32' },
                },
            },
        });
    }

    set debugMode(value: number)
    {
        this.resources.slugUniforms.uniforms.uDebugMode = value;
    }
}
