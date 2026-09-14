(() => {
  if(window.top !== window)
  {
    return;
  }

  const host = document.createElement("div");
  const shadow = host.attachShadow({mode: "closed"});
  const style = document.createElement("style");
  const canvas = document.createElement("canvas");
  const panel = document.createElement("div");
  const toggle = document.createElement("button");
  const color = document.createElement("input");
  const imageColor = document.createElement("input");
  const label = document.createElement("label");
  const cellLabel = document.createElement("label");
  const cellSizeInput = document.createElement("input");
  const cellSizeValue = document.createElement("span");

  style.textContent = `
    :host { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
    canvas { position: fixed; display: none; pointer-events: none; image-rendering: pixelated; }
    #panel { position: fixed; right: 16px; bottom: 16px; display: flex; gap: 8px; align-items: center; padding: 8px 10px; color: white; background: rgba(0, 0, 0, .72); border-radius: 6px; font: 13px system-ui, sans-serif; pointer-events: auto; }
    button { border: 0; border-radius: 4px; padding: 6px 9px; color: white; background: #198754; cursor: pointer; }
    button.off { background: #555; }
    input[type=color] { width: 28px; height: 24px; padding: 0; border: 0; background: transparent; cursor: pointer; }
    input[type=range] { width: 72px; margin: 0; vertical-align: middle; cursor: pointer; }
    label { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
  `;

  toggle.textContent = "ASCII on";
  toggle.title = "Toggle ASCII video rendering";
  color.type = "color";
  color.value = "#00ffcc";
  color.title = "ASCII color";
  imageColor.type = "checkbox";
  imageColor.checked = true;
  label.append(imageColor, "Source color");
  cellSizeInput.type = "range";
  cellSizeInput.min = "4";
  cellSizeInput.max = "16";
  cellSizeInput.step = "1";
  cellSizeInput.value = "8";
  cellSizeInput.title = "ASCII cell size";
  cellSizeValue.textContent = "8";
  cellLabel.append("Size", cellSizeInput, cellSizeValue);
  panel.id = "panel";
  panel.append(toggle, color, label, cellLabel);
  shadow.append(style, canvas, panel);
  document.documentElement.append(host);

  let enabled = false;
  let video;
  let device;
  let context;
  let pipeline;
  let bindGroup;
  let sourceTexture;
  let uniformBuffer;
  let sourceWidth = 1;
  let sourceHeight = 1;
  let animationFrame;

  const shaderCode = `
    @group(0) @binding(0) var texSampler: sampler;
    @group(0) @binding(1) var tex: texture_2d<f32>;

    struct Uniforms {
      scale: vec2f,
      imageSize: vec2f,
      tintColor: vec4f,
      useImageColor: f32,
      cellSize: f32,
    };

    @group(0) @binding(2) var<uniform> uniforms: Uniforms;

    struct VertexOutput {
      @builtin(position) position: vec4f,
      @location(0) uv: vec2f,
    };

    @vertex
    fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
      var positions = array<vec2f, 4>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, 1.0)
      );
      var uvs = array<vec2f, 4>(
        vec2f(0.0, 1.0), vec2f(1.0, 1.0),
        vec2f(0.0, 0.0), vec2f(1.0, 0.0)
      );
      var output: VertexOutput;
      output.position = vec4f(positions[index] * uniforms.scale, 0.0, 1.0);
      output.uv = uvs[index];
      return output;
    }

    fn glyphRow(index: u32, row: u32) -> u32 {
      if(index == 0u) { return 0u; }
      if(index == 1u) { if(row == 3u) { return 4u; } return 0u; }
      if(index == 2u) { if(row == 3u) { return 14u; } return 0u; }
      if(index == 3u) { if(row == 1u || row == 5u) { return 4u; } if(row == 2u || row == 4u) { return 10u; } return 0u; }
      if(index == 4u) { if(row == 1u || row == 5u) { return 4u; } if(row == 2u || row == 4u) { return 14u; } return 0u; }
      if(index == 5u) { if(row == 1u || row == 5u) { return 4u; } if(row == 2u || row == 4u) { return 14u; } if(row == 3u) { return 31u; } return 0u; }
      if(index == 6u) { if(row == 0u || row == 6u) { return 31u; } if(row == 1u || row == 5u) { return 17u; } return 21u; }
      if(index == 7u) { if(row == 0u || row == 6u) { return 31u; } if(row == 1u || row == 5u) { return 27u; } return 23u; }
      if(row == 0u || row == 6u) { return 31u; }
      return 27u;
    }

    @fragment
    fn fs(input: VertexOutput) -> @location(0) vec4f {
      let cellSize = max(uniforms.cellSize, 1.0);
      let pixel = input.uv * uniforms.imageSize;
      let cellUV = fract(pixel / cellSize);
      let cell = floor(pixel / cellSize);
      let uv = (cell * cellSize + cellSize * 0.5) / uniforms.imageSize;
      let color = textureSample(tex, texSampler, uv);
      let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
      let brightness = pow(clamp(luminance, 0.0, 1.0), 0.55);
      let index = min(u32(brightness * 10.0), 9u);
      let glyphX = min(u32(cellUV.x * 5.0), 4u);
      let glyphY = min(u32(cellUV.y * 7.0), 6u);
      let glyph = f32((glyphRow(index, glyphY) >> (4u - glyphX)) & 1u);
      var outputColor = uniforms.tintColor.rgb;
      if(uniforms.useImageColor > 0.5) {
        let maxC = max(color.r, max(color.g, color.b));
        outputColor = color.rgb / max(maxC, 0.001) * mix(0.35, 1.0, brightness);
      }
      return vec4f(outputColor * glyph, glyph);
    }
  `;

  function hexToRgb(value)
  {
    return [
      parseInt(value.slice(1, 3), 16) / 255,
      parseInt(value.slice(3, 5), 16) / 255,
      parseInt(value.slice(5, 7), 16) / 255
    ];
  }

  function updateUniforms()
  {
    if(!uniformBuffer || !video)
    {
      return;
    }

    const rect = video.getBoundingClientRect();
    const canvasAspect = rect.width / rect.height;
    const imageAspect = sourceWidth / sourceHeight;
    const scale = imageAspect > canvasAspect
      ? [1, canvasAspect / imageAspect]
      : [imageAspect / canvasAspect, 1];

    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
      scale[0], scale[1], sourceWidth, sourceHeight,
      ...hexToRgb(color.value), 1,
      imageColor.checked ? 1 : 0, Number(cellSizeInput.value), 0, 0
    ]));
  }

  function resize()
  {
    if(!video || !enabled)
    {
      return;
    }

    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.left = `${rect.left}px`;
    canvas.style.top = `${rect.top}px`;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    context.configure({device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: "premultiplied"});
    updateUniforms();
  }

  function render()
  {
    if(!enabled || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
    {
      animationFrame = requestAnimationFrame(render);
      return;
    }

    device.queue.copyExternalImageToTexture(
      {source: video},
      {texture: sourceTexture},
      [sourceWidth, sourceHeight]
    );

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: {r: 0, g: 0, b: 0, a: 0},
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();
    device.queue.submit([encoder.finish()]);
    animationFrame = requestAnimationFrame(render);
  }

  async function initialize()
  {
    if(!navigator.gpu)
    {
      toggle.textContent = "WebGPU unavailable";
      toggle.disabled = true;
      return;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if(!adapter)
    {
      toggle.textContent = "GPU unavailable";
      toggle.disabled = true;
      return;
    }

    device = await adapter.requestDevice();
    context = canvas.getContext("webgpu");
    const module = device.createShaderModule({code: shaderCode});
    pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {module, entryPoint: "vs"},
      fragment: {module, entryPoint: "fs", targets: [{format: navigator.gpu.getPreferredCanvasFormat()}]},
      primitive: {topology: "triangle-strip"}
    });
    uniformBuffer = device.createBuffer({size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    const sampler = device.createSampler({magFilter: "nearest", minFilter: "nearest"});
    bindGroup = null;
    toggle.disabled = false;
  }

  function findVideo()
  {
    const videos = [...document.querySelectorAll("video")];
    return videos.find(candidate => candidate.videoWidth > 0 && candidate.videoHeight > 0)
      || videos[0];
  }

  function setSource(nextVideo)
  {
    if(!nextVideo)
    {
      return;
    }

    if(nextVideo === video)
    {
      sourceWidth = video.videoWidth || 1;
      sourceHeight = video.videoHeight || 1;
      sourceTexture?.destroy();
    }
    else
    {
      if(video)
      {
        video.style.opacity = "";
      }
      video = nextVideo;
      sourceWidth = video.videoWidth || 1;
      sourceHeight = video.videoHeight || 1;
      video.addEventListener("loadedmetadata", () => {
        if(enabled)
        {
          setSource(video);
        }
      });
    }

    sourceTexture = device.createTexture({
      size: [sourceWidth, sourceHeight],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: device.createSampler({magFilter: "nearest", minFilter: "nearest"})},
        {binding: 1, resource: sourceTexture.createView()},
        {binding: 2, resource: {buffer: uniformBuffer}}
      ]
    });
    resize();
  }

  async function setEnabled(nextEnabled)
  {
    enabled = nextEnabled;
    if(enabled)
    {
      setSource(findVideo());
      if(!video)
      {
        enabled = false;
        return;
      }
      video.style.opacity = "0";
      canvas.style.display = "block";
      toggle.textContent = "ASCII off";
      toggle.classList.remove("off");
      resize();
      cancelAnimationFrame(animationFrame);
      render();
    }
    else
    {
      cancelAnimationFrame(animationFrame);
      canvas.style.display = "none";
      if(video) { video.style.opacity = ""; }
      toggle.textContent = "ASCII on";
      toggle.classList.add("off");
    }
  }

  toggle.disabled = true;
  toggle.classList.add("off");
  toggle.addEventListener("click", () => setEnabled(!enabled));
  color.addEventListener("input", updateUniforms);
  imageColor.addEventListener("change", updateUniforms);
  cellSizeInput.addEventListener("input", () => {
    cellSizeValue.textContent = cellSizeInput.value;
    updateUniforms();
  });
  window.addEventListener("resize", resize);
  document.addEventListener("fullscreenchange", resize);
  new MutationObserver(() => {
    if(enabled)
    {
      const nextVideo = findVideo();
      if(nextVideo !== video) { setSource(nextVideo); }
      resize();
    }
  }).observe(document.body, {childList: true, subtree: true});

  initialize().catch(() => {
    toggle.textContent = "ASCII unavailable";
    toggle.disabled = true;
  });
})();
