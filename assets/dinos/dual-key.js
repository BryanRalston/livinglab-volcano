// Samsung fallback for dinos. play.webm is one YUVA track (alpha_mode=1).
// play_dual.webm is two VP9 tracks: color (black where keyed) and a gray alphaextract.
// Chrome on Samsung uploads the YUVA file as opaque black. This player decodes both
// tracks and paints straight alpha into a canvas the page and the AR mesh can share.

// Samsung paints at 15fps. Closer frames are dropped so decode stays on that cadence.
const PAINT_MS = 1000 / 15;
const PAINT_US = Math.round(1e6 / 15);

function readId(buf, index) {
  const b0 = buf[index];
  let width = 0;
  if (b0 & 0x80) width = 1;
  else if (b0 & 0x40) width = 2;
  else if (b0 & 0x20) width = 3;
  else if (b0 & 0x10) width = 4;
  else throw new Error("Bad EBML id");
  let value = 0;
  for (let i = 0; i < width; i++) value = (value * 256) + buf[index + i];
  return { value, next: index + width };
}

function readSize(buf, index) {
  const b0 = buf[index];
  let width = 0;
  if (b0 & 0x80) width = 1;
  else if (b0 & 0x40) width = 2;
  else if (b0 & 0x20) width = 3;
  else if (b0 & 0x10) width = 4;
  else if (b0 & 0x08) width = 5;
  else if (b0 & 0x04) width = 6;
  else if (b0 & 0x02) width = 7;
  else if (b0 & 0x01) width = 8;
  else throw new Error("Bad EBML size");
  // Drop the leading length bit. Avoid 32-bit bitwise ops; sizes here use 8-byte vints.
  const marker = 1 << (8 - width);
  let value = b0 & (marker - 1);
  for (let i = 1; i < width; i++) value = (value * 256) + buf[index + i];
  return { value, next: index + width };
}

export function demuxDualVp9(buffer) {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const tracks = { 1: [], 2: [] };

  function parseSimple(block, clusterMs) {
    const track = readSize(block, 0);
    const hi = block[track.next];
    const lo = block[track.next + 1];
    let rel = (hi << 8) | lo;
    if (rel & 0x8000) rel -= 0x10000;
    const flags = block[track.next + 2];
    const lace = (flags >> 1) & 0x03;
    if (lace !== 0) throw new Error("Laced dual frame is not supported");
    const list = tracks[track.value];
    if (!list) return;
    list.push({
      timestamp: (clusterMs + rel) * 1000,
      key: (flags & 0x80) !== 0,
      data: block.subarray(track.next + 3),
    });
  }

  function parseCluster(start, end) {
    let index = start;
    let clusterMs = 0;
    while (index + 2 <= end) {
      const id = readId(buf, index);
      const size = readSize(buf, id.next);
      const payloadEnd = size.next + size.value;
      if (id.value === 0xe7) {
        clusterMs = 0;
        for (let i = size.next; i < payloadEnd; i++) clusterMs = (clusterMs * 256) + buf[i];
      } else if (id.value === 0xa3) {
        parseSimple(buf.subarray(size.next, payloadEnd), clusterMs);
      }
      index = payloadEnd;
    }
  }

  function walk(start, end) {
    let index = start;
    while (index + 2 <= end) {
      const id = readId(buf, index);
      const size = readSize(buf, id.next);
      const payloadEnd = size.next + size.value;
      if (id.value === 0x18538067 || id.value === 0x1654ae6b) walk(size.next, payloadEnd);
      else if (id.value === 0x1f43b675) parseCluster(size.next, payloadEnd);
      index = payloadEnd;
    }
  }

  walk(0, buf.length);
  if (tracks[1].length !== tracks[2].length || tracks[1].length === 0) {
    throw new Error("Dual clip tracks do not match");
  }
  return { color: tracks[1], alpha: tracks[2] };
}

async function pickCodec(codecs) {
  if (typeof VideoDecoder === "undefined" || !VideoDecoder.isConfigSupported) {
    throw new Error("This browser cannot decode the dual clip");
  }
  for (const codec of codecs) {
    const support = await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true });
    if (support.supported) return codec;
  }
  throw new Error("This browser cannot decode the dual clip");
}

function openDecoder(codec) {
  let resolveFrame = null;
  let rejectFrame = null;
  const decoder = new VideoDecoder({
    output(frame) {
      const resolve = resolveFrame;
      resolveFrame = null;
      rejectFrame = null;
      if (resolve) resolve(frame);
      else frame.close();
    },
    error(err) {
      const reject = rejectFrame;
      resolveFrame = null;
      rejectFrame = null;
      if (reject) reject(err);
    },
  });
  decoder.configure({ codec, optimizeForLatency: true });
  return {
    decode(packet) {
      return new Promise((resolve, reject) => {
        resolveFrame = resolve;
        rejectFrame = reject;
        decoder.decode(new EncodedVideoChunk({
          type: packet.key ? "key" : "delta",
          timestamp: packet.timestamp,
          data: packet.data,
        }));
      });
    },
    async reset() {
      await decoder.flush();
      decoder.configure({ codec, optimizeForLatency: true });
    },
    close() {
      if (decoder.state !== "closed") decoder.close();
    },
  };
}

function makeCompositor(width, height) {
  const glCanvas = document.createElement("canvas");
  glCanvas.width = width;
  glCanvas.height = height;
  const gl = glCanvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
  });
  if (!gl) throw new Error("Could not composite the dual clip");

  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, "attribute vec2 p;varying vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,0.0,1.0);}");
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, "precision mediump float;varying vec2 v;uniform sampler2D c;uniform sampler2D a;void main(){gl_FragColor=vec4(texture2D(c,v).rgb,texture2D(a,v).r);}");
  gl.compileShader(fs);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || "Could not composite the dual clip");
  }
  gl.useProgram(prog);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  function makeTex(unit) {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  const colorTex = makeTex(0);
  const alphaTex = makeTex(1);
  gl.uniform1i(gl.getUniformLocation(prog, "c"), 0);
  gl.uniform1i(gl.getUniformLocation(prog, "a"), 1);
  gl.viewport(0, 0, width, height);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);

  function upload(unit, tex, frame) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  }

  return {
    paint(colorFrame, alphaFrame, target) {
      upload(0, colorTex, colorFrame);
      upload(1, alphaTex, alphaFrame);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      target.clearRect(0, 0, width, height);
      target.drawImage(glCanvas, 0, 0, width, height);
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextPaintIndex(color, alpha, index, shownTs) {
  if (shownTs < 0 || index >= color.length) return index;
  const minTs = shownTs + Math.round(1e6 / 20);
  if (color[index].timestamp >= minTs) return index;
  for (let i = index; i < color.length; i++) {
    if (color[i].timestamp >= minTs && color[i].key && alpha[i].key) return i;
  }
  return index;
}

export function createDualPlayback(canvas) {
  let token = 0;
  let running = false;
  let cachedUrl = "";
  let cachedTracks = null;

  async function loadTracks(url) {
    if (cachedUrl === url && cachedTracks) return cachedTracks;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not load the dual clip");
    cachedTracks = demuxDualVp9(await response.arrayBuffer());
    cachedUrl = url;
    return cachedTracks;
  }

  async function run(url, alive, ready) {
    const { color, alpha } = await loadTracks(url);
    const colorCodec = await pickCodec(["vp09.00.10.08", "vp09.00.41.08", "vp9"]);
    const alphaCodec = await pickCodec(["vp09.01.10.08", "vp09.00.10.08", "vp09.01.41.08", "vp9"]);
    const colorDec = openDecoder(colorCodec);
    const alphaDec = openDecoder(alphaCodec);
    let paint = null;
    let compositor = null;
    let index = 0;
    let shownTs = -PAINT_US;
    try {
      while (alive()) {
        const started = performance.now();
        const landed = nextPaintIndex(color, alpha, index, shownTs);
        if (landed !== index) {
          await colorDec.reset();
          await alphaDec.reset();
          index = landed;
        }
        if (index >= color.length) {
          index = 0;
          shownTs = -PAINT_US;
          await colorDec.reset();
          await alphaDec.reset();
          continue;
        }
        const colorFrame = await colorDec.decode(color[index]);
        const alphaFrame = await alphaDec.decode(alpha[index]);
        if (!alive()) {
          colorFrame.close();
          alphaFrame.close();
          break;
        }
        if (!compositor) {
          const width = colorFrame.displayWidth || colorFrame.codedWidth;
          const height = colorFrame.displayHeight || colorFrame.codedHeight;
          canvas.width = width;
          canvas.height = height;
          paint = canvas.getContext("2d", { alpha: true, willReadFrequently: false });
          compositor = makeCompositor(width, height);
        }
        compositor.paint(colorFrame, alphaFrame, paint);
        colorFrame.close();
        alphaFrame.close();
        shownTs = color[index].timestamp;
        if (ready) {
          ready();
          ready = null;
        }
        index += 1;
        if (index >= color.length) {
          index = 0;
          shownTs = -PAINT_US;
          await colorDec.reset();
          await alphaDec.reset();
        }
        const leftover = PAINT_MS - (performance.now() - started);
        if (leftover > 1) await wait(leftover);
      }
    } finally {
      colorDec.close();
      alphaDec.close();
    }
  }

  return {
    get running() {
      return running;
    },
    start(url) {
      const my = ++token;
      running = true;
      return new Promise((resolve, reject) => {
        run(url, () => token === my, resolve).catch((err) => {
          if (token === my) {
            running = false;
            reject(err);
          }
        });
      });
    },
    stop() {
      token += 1;
      running = false;
    },
  };
}
