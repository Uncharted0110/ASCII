import "./style.css";

const canvas = document.querySelector("#canvas");
const status = document.querySelector("#status");
const uploadInput = document.querySelector("#upload");
const colorInput = document.querySelector("#color");
const imageColorInput = document.querySelector("#image-color");

if(!navigator.gpu) 
{
  throw new Error("WebGPU is not supported");
}

const adapter = await navigator.gpu.requestAdapter();

if(!adapter)
{
  throw new Error("Failed to get GPU adapter");
}

const device = await adapter.requestDevice();

const context = canvas.getContext("webgpu");

const format = navigator.gpu.getPreferredCanvasFormat();
let pipeline;
let bindGroup;
let aspectBuffer;
let cameraTexture;
let cameraVideo;
let sourceElement;
let sourceWidth = 1;
let sourceHeight = 1;
let sampler;
let asciiTexture;

function hexToRgb(hex)
{
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
}

function getQuadScale()
{
  const canvasAspect = canvas.width / canvas.height;

  const imageAspect = sourceWidth / sourceHeight;

  if(imageAspect > canvasAspect)
  {
    return [1, canvasAspect / imageAspect];
  }

  return [imageAspect / canvasAspect, 1];
}

function updateQuadScale()
{
  if(!aspectBuffer)
  {
    return;
  }

  const [scaleX, scaleY] = getQuadScale();

  device.queue.writeBuffer(
    aspectBuffer,
    0,
    new Float32Array([
      scaleX,
      scaleY,
      sourceWidth,
      sourceHeight,
      ...hexToRgb(colorInput.value),
      1,
      imageColorInput.checked ? 1 : 0,
      0,
      0,
      0,
    ])
  );
}

colorInput.addEventListener("input", updateQuadScale);
imageColorInput.addEventListener("change", updateQuadScale);

function resizeCanvas()
{
  const devicePixelRatio = window.devicePixelRatio;
  const width = canvas.clientWidth * devicePixelRatio;
  const height = canvas.clientHeight * devicePixelRatio;

  if(canvas.width !== width || canvas.height !== height)
  {
    canvas.width = width;
    canvas.height = height;

    context.configure({
      device,
      format,
      alphaMode: "opaque"
    });

    updateQuadScale();

    if(pipeline && bindGroup)
    {
      render();
    }
  }
}

resizeCanvas();
window.addEventListener("resize", resizeCanvas);

console.log("WebGPU Initialized");

import shaderCode from "./shader.wgsl?raw";

const shaderModule = device.createShaderModule({
  code: shaderCode
});

pipeline = device.createRenderPipeline({
  layout: "auto",

  vertex: {
    module: shaderModule,
    entryPoint: "vs"
  },

  fragment: {
    module: shaderModule,
    entryPoint: "fs",
    targets: [
      {
        format: format
      }
    ]
  },

  primitive: {
    topology: "triangle-strip"
  }
});

function render()
{
  if(!pipeline || !bindGroup || !sourceElement)
  {
    return;
  }

  device.queue.copyExternalImageToTexture(
    {source: sourceElement},
    {texture: cameraTexture},
    [sourceWidth, sourceHeight]
  );

  const commandEncoder = device.createCommandEncoder();
  
  const textureView = context.getCurrentTexture().createView();

  const renderPass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: textureView,

        clearValue:
        {
          r: 1,
          g: 1,
          b: 1,
          a: 1
        },

        loadOp: "clear",
        storeOp: "store"
      }
    ]
  });

  renderPass.setPipeline(pipeline);
  renderPass.setBindGroup(0, bindGroup);

  renderPass.draw(4);

  renderPass.end();

  device.queue.submit([
    commandEncoder.finish()
  ]);
}

const cameraStream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: false
});

cameraVideo = document.createElement("video");
cameraVideo.autoplay = true;
cameraVideo.muted = true;
cameraVideo.playsInline = true;
cameraVideo.srcObject = cameraStream;

await new Promise((resolve) => {
  cameraVideo.addEventListener("loadedmetadata", resolve, {once: true});
});

await cameraVideo.play();

sourceElement = cameraVideo;
sourceWidth = cameraVideo.videoWidth;
sourceHeight = cameraVideo.videoHeight;
status.textContent = "";

aspectBuffer = device.createBuffer({
  size: 48,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

updateQuadScale();

const texture = device.createTexture({
  size: [sourceWidth, sourceHeight],
  format: "rgba8unorm",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
});

cameraTexture = texture;

sampler = device.createSampler({
  magFilter: "nearest",
  minFilter: "nearest"
});

const asciiImage = new Image();
asciiImage.src = "/texture.png";

await asciiImage.decode();

asciiTexture = device.createTexture({
  size: [asciiImage.width, asciiImage.height],
  format: "rgba8unorm",
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
});

device.queue.copyExternalImageToTexture(
  {source: asciiImage},
  {texture: asciiTexture},
  [asciiImage.width, asciiImage.height]
);

bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),

  entries: [
    {
      binding: 0,
      resource: sampler
    },
    {
      binding: 1,
      resource: texture.createView()
    },
    {
      binding: 2,
      resource: {
        buffer: aspectBuffer
      }
    },
    {
      binding: 3,
      resource: asciiTexture.createView()
    }
  ]
});

uploadInput.addEventListener("change", async () => {
  const file = uploadInput.files[0];

  if(!file)
  {
    return;
  }

  const uploadedImage = new Image();
  uploadedImage.src = URL.createObjectURL(file);
  await uploadedImage.decode();

  sourceElement = uploadedImage;
  sourceWidth = uploadedImage.width;
  sourceHeight = uploadedImage.height;

  cameraTexture.destroy();
  cameraTexture = device.createTexture({
    size: [sourceWidth, sourceHeight],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });

  device.queue.copyExternalImageToTexture(
    {source: uploadedImage},
    {texture: cameraTexture},
    [sourceWidth, sourceHeight]
  );

  bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {binding: 0, resource: sampler},
      {binding: 1, resource: cameraTexture.createView()},
      {binding: 2, resource: {buffer: aspectBuffer}},
      {binding: 3, resource: asciiTexture.createView()}
    ]
  });

  updateQuadScale();
  URL.revokeObjectURL(uploadedImage.src);
});

function frame()
{
  render();
  requestAnimationFrame(frame);
}

frame();