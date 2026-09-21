/**
 * In-page video file for Living Lab Record on Android.
 * Frames are read from a 2D canvas and encoded with WebCodecs VideoEncoder,
 * then muxed by mp4-muxer (AVC) or webm-muxer (VP8/VP9).
 * MediaRecorder and captureStream are intentionally not used.
 */
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "./mp4-muxer.js";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "./webm-muxer.js";

const FPS = 30;
const FRAME_US = Math.round(1000000 / FPS);

function fitEven(w, h, maxW, maxH) {
  let width = Math.max(2, Math.round(w));
  let height = Math.max(2, Math.round(h));
  const scale = Math.min(1, maxW / width, maxH / height);
  width = Math.max(2, Math.round(width * scale));
  height = Math.max(2, Math.round(height * scale));
  if (width % 2) width -= 1;
  if (height % 2) height -= 1;
  return { width, height };
}

export function evenEncodeSize(cssW, cssH, dpr) {
  const scale = Math.min(Math.max(Number(dpr) || 1, 1), 2);
  return fitEven((Number(cssW) || 360) * scale, (Number(cssH) || 280) * scale, 640, 480);
}

export function webCodecsPresent() {
  return typeof VideoEncoder === "function" &&
    typeof VideoFrame === "function" &&
    typeof VideoEncoder.isConfigSupported === "function";
}

function avcPlan(id, codec, hardwareAcceleration, width, height) {
  return {
    id,
    mux: "mp4",
    mime: "video/mp4",
    muxCodec: "avc",
    config: {
      codec,
      width,
      height,
      bitrate: 1500000,
      framerate: FPS,
      hardwareAcceleration,
      avc: { format: "avc" },
      latencyMode: "quality",
    },
  };
}

function webmPlan(id, codec, muxCodec, hardwareAcceleration, width, height) {
  return {
    id,
    mux: "webm",
    mime: "video/webm",
    muxCodec,
    config: {
      codec,
      width,
      height,
      bitrate: 1500000,
      framerate: FPS,
      hardwareAcceleration,
      latencyMode: "quality",
    },
  };
}

function plansFor(width, height) {
  return [
    avcPlan("avc-hw", "avc1.42001f", "prefer-hardware", width, height),
    avcPlan("avc-hw-main", "avc1.4d001f", "prefer-hardware", width, height),
    avcPlan("avc-sw", "avc1.42001f", "prefer-software", width, height),
    webmPlan("vp8-sw", "vp8", "V_VP8", "prefer-software", width, height),
    webmPlan("vp8-hw", "vp8", "V_VP8", "prefer-hardware", width, height),
    webmPlan("vp9-sw", "vp09.00.10.08", "V_VP9", "prefer-software", width, height),
  ];
}

async function pickPlan(width, height) {
  const plans = plansFor(width, height);
  for (let i = 0; i < plans.length; i++) {
    try {
      const support = await VideoEncoder.isConfigSupported(plans[i].config);
      if (support && support.supported) return plans[i];
    } catch (_) {}
  }
  return null;
}

function videoFrame(canvas, timestamp) {
  try {
    return new VideoFrame(canvas, { timestamp, duration: FRAME_US, alpha: "discard" });
  } catch (_) {
    return new VideoFrame(canvas, { timestamp, duration: FRAME_US });
  }
}

function looksLikeVideo(buffer, mime) {
  if (!buffer || buffer.byteLength < 512) return false;
  const bytes = new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength));
  if (mime === "video/mp4") {
    let text = "";
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return text.indexOf("ftyp") >= 0;
  }
  return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

/**
 * @param {number} width
 * @param {number} height
 */
export async function startCanvasEncoder(width, height) {
  if (!webCodecsPresent()) {
    throw new Error("WebCodecs VideoEncoder is missing in this Chrome.");
  }
  if (!width || !height || width % 2 || height % 2) {
    throw new Error("Encoder size must be positive even pixels.");
  }
  const plan = await pickPlan(width, height);
  if (!plan) {
    throw new Error("No WebCodecs video config is supported at " + width + "x" + height + ".");
  }

  const target = plan.mux === "mp4" ? new Mp4Target() : new WebmTarget();
  const muxer = plan.mux === "mp4"
    ? new Mp4Muxer({
      target,
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
      video: { codec: "avc", width, height, frameRate: FPS },
    })
    : new WebmMuxer({
      target,
      firstTimestampBehavior: "offset",
      video: { codec: plan.muxCodec, width, height, frameRate: FPS },
    });

  let encoderError = null;
  let chunks = 0;
  let closed = false;
  let frameIndex = 0;

  function addChunk(chunk, meta) {
    chunks += 1;
    if (plan.mux === "mp4") {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const duration = Number.isFinite(chunk.duration) ? chunk.duration : FRAME_US;
      muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, duration, meta);
      return;
    }
    muxer.addVideoChunk(chunk, meta);
  }

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        addChunk(chunk, meta);
      } catch (err) {
        encoderError = err || new Error("Muxer rejected an encoded chunk.");
      }
    },
    error: (err) => {
      encoderError = err || new Error("VideoEncoder error");
    },
  });
  encoder.configure(plan.config);
  await new Promise((resolve) => queueMicrotask(resolve));
  if (encoderError || encoder.state === "closed") {
    throw encoderError || new Error("VideoEncoder closed during configure.");
  }

  function pushCanvas(canvas, keyFrame) {
    if (encoderError) throw encoderError;
    if (closed) return;
    if (canvas.width !== width || canvas.height !== height) {
      throw new Error("Encode canvas is " + canvas.width + "x" + canvas.height + ", encoder is " + width + "x" + height + ".");
    }
    if (!keyFrame && frameIndex > 0 && encoder.encodeQueueSize > 3) return;
    const frame = videoFrame(canvas, frameIndex * FRAME_US);
    try {
      encoder.encode(frame, { keyFrame: frameIndex === 0 || !!keyFrame });
      frameIndex += 1;
    } finally {
      frame.close();
    }
  }

  async function finish() {
    if (closed) throw new Error("Encoder already finished.");
    closed = true;
    if (encoderError) throw encoderError;
    if (frameIndex < 1) throw new Error("No frames were encoded.");
    if (encoder.state === "configured") await encoder.flush();
    if (encoderError) throw encoderError;
    if (encoder.state !== "closed") encoder.close();
    muxer.finalize();
    const buffer = target.buffer;
    if (!looksLikeVideo(buffer, plan.mime) || chunks < 1) {
      throw new Error("Encoder finished without a playable video file.");
    }
    return {
      blob: new Blob([buffer], { type: plan.mime }),
      mime: plan.mime,
      frames: frameIndex,
      chunks,
      planId: plan.id,
      width,
      height,
    };
  }

  function cancel() {
    closed = true;
    try {
      if (encoder.state !== "closed") encoder.close();
    } catch (_) {}
  }

  return {
    pushCanvas,
    finish,
    cancel,
    failed: () => encoderError,
    mime: plan.mime,
    planId: plan.id,
    width,
    height,
  };
}
