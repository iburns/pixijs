export const mSDFBit = {
    name: 'msdf-bit',
    fragment: {
        header: /* wgsl */`
            fn calculateMSDFAlpha(msdfColor:vec4<f32>, shapeColor:vec4<f32>, distance:f32) -> f32 {
                
                // MSDF
                var median = msdfColor.r + msdfColor.g + msdfColor.b -
                    min(msdfColor.r, min(msdfColor.g, msdfColor.b)) -
                    max(msdfColor.r, max(msdfColor.g, msdfColor.b));
            
                // SDF
                median = min(median, msdfColor.a);

                // Ultra-sharp distance scaling
                var screenPxDistance = distance * (median - 0.5);
                
                // Minimal anti-aliasing - extremely sharp edges
                var pixelRange = distance * 0.02; // Reduced from 0.1 to 0.02 for maximum sharpness
                pixelRange = max(pixelRange, 0.1); // Absolute minimum to prevent complete aliasing
                
                // Sharp edge transition with minimal smoothing
                var alpha = smoothstep(-pixelRange, pixelRange, screenPxDistance);
                
                // Aggressive edge detection for maximum sharpness
                if (median < 0.05) {
                    alpha = 0.0;
                } else if (median > 0.95) {
                    alpha = 1.0;
                } else {
                    // More aggressive sharpening - narrower transition zone
                    alpha = smoothstep(0.45, 0.55, alpha);
                }

                // Reduced gamma correction to maintain sharpness
                var luma: f32 = dot(shapeColor.rgb, vec3<f32>(0.299, 0.587, 0.114));
                var gamma: f32 = mix(1.0, 1.0 / 1.8, luma); // Reduced gamma correction
                var coverage: f32 = pow(shapeColor.a * alpha, gamma);

                return coverage;
             
            }
        `,
    }

};

export const mSDFBitGl = {
    name: 'msdf-bit',
    fragment: {
        header: /* glsl */`
            float calculateMSDFAlpha(vec4 msdfColor, vec4 shapeColor, float distance) {
                
                // MSDF
                float median = msdfColor.r + msdfColor.g + msdfColor.b -
                                min(msdfColor.r, min(msdfColor.g, msdfColor.b)) -
                                max(msdfColor.r, max(msdfColor.g, msdfColor.b));
               
                // SDF
                median = min(median, msdfColor.a);
            
                // Ultra-sharp distance scaling
                float screenPxDistance = distance * (median - 0.5);
                
                // Minimal anti-aliasing - extremely sharp edges
                float pixelRange = distance * 0.02; // Reduced from 0.1 to 0.02 for maximum sharpness
                pixelRange = max(pixelRange, 0.1); // Absolute minimum to prevent complete aliasing
                
                // Sharp edge transition with minimal smoothing
                float alpha = smoothstep(-pixelRange, pixelRange, screenPxDistance);
                
                // Aggressive edge detection for maximum sharpness
                if (median < 0.05) {
                    alpha = 0.0;
                } else if (median > 0.95) {
                    alpha = 1.0;
                } else {
                    // More aggressive sharpening - narrower transition zone
                    alpha = smoothstep(0.45, 0.55, alpha);
                }

                // Reduced gamma correction to maintain sharpness
                float luma = dot(shapeColor.rgb, vec3(0.299, 0.587, 0.114));
                float gamma = mix(1.0, 1.0 / 1.8, luma); // Reduced gamma correction
                float coverage = pow(shapeColor.a * alpha, gamma);  
              
                return coverage;
            }
        `,
    }

};
