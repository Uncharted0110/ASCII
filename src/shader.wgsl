@group(0) @binding(0)
var texSampler: sampler;

@group(0) @binding(1)
var tex: texture_2d<f32>;

struct QuadScale {
    scale: vec2f,
    imageSize: vec2f,
    tintColor: vec4f,
    useImageColor: f32,
};

@group(0) @binding(2)
var<uniform> quadScale: QuadScale;

@group(0) @binding(3)
var asciiTex: texture_2d<f32>;

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {

    var positions = array<vec2f, 4>(
        vec2f(-1.0, -1.0),
        vec2f( 1.0, -1.0),
        vec2f(-1.0, 1.0),
        vec2f( 1.0, 1.0)
    );

    var uvs = array<vec2f, 4>(
        vec2f(0.0, 1.0),
        vec2f(1.0, 1.0),
        vec2f(0.0, 0.0),
        vec2f(1.0, 0.0)
    );

    var output : VertexOutput;

    output.position = vec4f(positions[vertexIndex] * quadScale.scale.xy, 0.0, 1.0);
    output.uv = uvs[vertexIndex];

    return output;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {

    let cellSize = 4.0;

    // Pixel position in the original image
    let pixel = input.uv * quadScale.imageSize;

    // Position inside the current cell.
    // Equivalent to:
    // (p mod cellSize) / cellSize
    let cellUV = fract(pixel / cellSize);

    // Center of the cell
    let cell = floor(pixel / cellSize);
    let cellCenter = cell * cellSize + cellSize * 0.5;

    // UV for sampling the original image
    let uv = cellCenter / quadScale.imageSize;

    // Sample original image
    let color = textureSample(
        tex,
        texSampler,
        uv
    );

    // RGB → luminance
    let luminance = dot(
        color.rgb,
        vec3f(0.2126, 0.7152, 0.0722)
    );

    // Convert luminance into one of 10 characters
    let characterIndex = min(
        u32(luminance * 10.0),
        9u
    );

    // Each character occupies 8×8 pixels in the ASCII texture atlas.
    let characterWidth = 8.0 / 80.0;

    // Position inside selected character
    let asciiUV = vec2f(
        f32(characterIndex) * characterWidth +
        cellUV.x * characterWidth,
        cellUV.y
    );

    // Sample ASCII character and apply either the selected tint or the cell color.
    let glyph = textureSample(
        asciiTex,
        texSampler,
        asciiUV
    );

    var outputColor = quadScale.tintColor.rgb;

    if(quadScale.useImageColor > 0.5)
    {
        outputColor = color.rgb;
    }

    return vec4f(outputColor * glyph.rgb, glyph.a);
}