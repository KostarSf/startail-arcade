import { Filter, GlProgram } from "pixi.js";

/**
 * Edge of World Filter
 *
 * Creates a pixelated black and white pattern effect with a pulsing shiny edge
 * at the world boundaries. Applied as a post-processing filter.
 */

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vFilterCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition() {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord() {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vFilterCoord = aPosition;
}
`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vFilterCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uWorldRadius;
uniform float uCameraX;
uniform float uCameraY;
uniform float uCameraScale;
uniform float uEdgeWidth;
uniform float uTime;
uniform float uPixelSize;

void main(void) {
    // Sample the original texture
    vec4 color = texture(uTexture, vTextureCoord);

    // Convert screen coordinates to world coordinates using filter coordinates
    // vFilterCoord goes from [0,0] to [1,1] across the filtered area
    vec2 screenPos = vFilterCoord * uResolution;
    vec2 screenCenter = uResolution * 0.5;
    vec2 worldPos = (screenPos - screenCenter) / uCameraScale + vec2(uCameraX, uCameraY);

    // Calculate distance from world center using SQUARE boundary (not circular)
    float distFromCenter = max(abs(worldPos.x), abs(worldPos.y));

    // Calculate distance from edge
    float distFromEdge = uWorldRadius - distFromCenter;

    // Edge effect parameters
    float edgeTransitionWidth = uEdgeWidth;
    float pulseFrequency = 2.0; // Hz
    float pulseAmplitude = 0.3;

    // Pulsing effect using sine wave
    float pulse = sin(uTime * 0.001 * pulseFrequency * 6.28318530718) * 0.5 + 0.5;

    // Color overlay mask: starts at worldRadius - 400, full at worldRadius
    float maskStartDistance = 1000.0;
    float maskAlpha = 0.0;

    if (distFromEdge < maskStartDistance) {
        // Calculate alpha: 0 at 400 pixels from edge, 1 at edge
        maskAlpha = smoothstep(maskStartDistance, 0.0, distFromEdge);

        // Apply desaturation and gamma reduction
        // Desaturate: convert to grayscale
        float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        vec3 grayscale = vec3(luminance);

        // Mix original color with grayscale based on mask alpha
        color.rgb = mix(color.rgb, grayscale, maskAlpha);

        // Decrease gamma (darken) - apply power curve
        // Higher values = darker (gamma > 1)
        vec3 darkened = pow(color.rgb, vec3(0.5));
        color.rgb = mix(color.rgb, darkened, maskAlpha);
    }

    // Only apply effect when BEYOND the world border (distFromEdge < 0)
    if (distFromEdge < 0.0) {
        // Create checkerboard pattern using SCREEN coordinates so it sticks to camera
        float cellSize = uPixelSize * 0.4; // Size of each checkerboard square

        // Use screen position instead of world position for camera-locked pattern
        vec2 cellPos = floor(screenPos / cellSize);

        // Create checkerboard: alternate between 0 and 1 based on cell position
        float checkerboard = mod(cellPos.x + cellPos.y, 2.0);

        // Create the pattern: alternating gray (0x666666) and black squares
        vec3 patternColor = vec3(0.4 * checkerboard); // 0x666666 = 102/255 = 0.4

        // Add pulsing shiny edge highlight at the exact boundary
        // Make it thinner and pixelated
        float edgeBoundary = abs(distFromEdge);

        // Pixelate the edge distance for discrete appearance
        float pixelatedEdgeDist = floor(edgeBoundary / 8.0) * 8.0;

        // Thinner shine width
        float shineWidth = 8.0 + pulse * 8.0;
        float shineIntensity = 0.0;

        // Hard cutoff - shine only within width, no smoothstep
        // Border color 0xaaaaaa = 170/255 = 0.667
        if (pixelatedEdgeDist < shineWidth) {
            shineIntensity = 0.667 + pulse * 0.2;
        }

        // Add extra bright pulse at exact edge (also pixelated)
        if (pixelatedEdgeDist < 8.0) {
            shineIntensity += 0.333 * pulse;
        }

        // Combine pattern and shine
        // Lines start right after shine (no blending)
        vec3 finalPattern;
        if (pixelatedEdgeDist < shineWidth) {
            // In shine area - pure white shine
            finalPattern = vec3(shineIntensity);
        } else {
            // Outside shine - show diagonal lines pattern
            finalPattern = patternColor;
        }

        // Hard cutoff - no gradient, just replace color completely
        color.rgb = finalPattern;
    }

    finalColor = color;
}
`;

export class EdgeOfWorldFilter extends Filter {
  constructor() {
    const program = GlProgram.from({
      vertex,
      fragment,
    });

    super({
      glProgram: program,
      resources: {
        edgeUniforms: {
          uResolution: { value: [800, 600], type: "vec2<f32>" },
          uWorldRadius: { value: 2000, type: "f32" },
          uCameraX: { value: 0, type: "f32" },
          uCameraY: { value: 0, type: "f32" },
          uCameraScale: { value: 1, type: "f32" },
          uEdgeWidth: { value: 400, type: "f32" },
          uTime: { value: 0, type: "f32" },
          uPixelSize: { value: 32, type: "f32" },
        },
      },
    });
  }

  /**
   * Update the camera position in world space
   */
  setCameraPosition(x: number, y: number) {
    this.resources.edgeUniforms.uniforms.uCameraX = x;
    this.resources.edgeUniforms.uniforms.uCameraY = y;
  }

  /**
   * Update the camera scale (zoom level)
   */
  setCameraScale(scale: number) {
    this.resources.edgeUniforms.uniforms.uCameraScale = scale;
  }

  /**
   * Update the world radius from server
   */
  setWorldRadius(radius: number) {
    this.resources.edgeUniforms.uniforms.uWorldRadius = radius;
  }

  /**
   * Update the screen resolution
   */
  setResolution(width: number, height: number) {
    this.resources.edgeUniforms.uniforms.uResolution = [width, height];
  }

  /**
   * Update the time for animation
   */
  setTime(time: number) {
    this.resources.edgeUniforms.uniforms.uTime = time;
  }

  /**
   * Set the edge transition width
   */
  setEdgeWidth(width: number) {
    this.resources.edgeUniforms.uniforms.uEdgeWidth = width;
  }

  /**
   * Set the pixel size for the pixelation effect
   */
  setPixelSize(size: number) {
    this.resources.edgeUniforms.uniforms.uPixelSize = size;
  }
}
