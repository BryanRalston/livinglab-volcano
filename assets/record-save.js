/**
 * Shared MediaRecorder save path for Living Lab.
 * Share-first (keeps the Stop user-gesture), then an on-page player,
 * then <a download> only as a last-ditch desktop fallback.
 * Do not rely on a.download + blob: URLs on Android Chrome.
 */

export function isAndroidUA(ua) {
  return /Android/i.test(ua || navigator.userAgent || "");
}

export function isAppleTouchUA(ua) {
  const agent = ua || navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(agent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function pickRecorderMime() {
  if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== "function") return "";
  // Android MediaRecorder mp4 is flaky (empty/broken files look like download fail).
  const types = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (let i = 0; i < types.length; i++) {
    if (MediaRecorder.isTypeSupported(types[i])) return types[i];
  }
  return "";
}

export function recorderExtension(mime) {
  return (mime || "").indexOf("mp4") >= 0 ? ".mp4" : ".webm";
}

export function recordingFilename(prefix, mime) {
  return prefix + new Date().toISOString().replace(/[:.]/g, "-") + recorderExtension(mime);
}

function lastDitchDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function showOnPagePlayer(blob, playerHost, setStatus) {
  if (!playerHost) {
    setStatus("Recording ready, but the on-page player is missing.", true);
    return;
  }
  if (playerHost._blobUrl) {
    URL.revokeObjectURL(playerHost._blobUrl);
    playerHost._blobUrl = "";
  }
  const url = URL.createObjectURL(blob);
  playerHost._blobUrl = url;
  playerHost.hidden = false;
  playerHost.innerHTML = "";

  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.src = url;
  video.className = "rec-player";

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Share/Save from the player";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "rec-copy";
  copy.textContent = "Copy link";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Copied player link (this page only).");
    } catch (_) {
      setStatus("Could not copy link.", true);
    }
  });

  playerHost.append(video, hint, copy);
  setStatus("Recording ready (" + Math.round(blob.size / 1024) + " KB). Share/Save from the player.");
}

/**
 * Call from the Stop click handler (same user-gesture) after MediaRecorder stops.
 * @param {Blob} blob
 * @param {{ filename: string, title: string, playerHost: HTMLElement, setStatus: Function }} opts
 */
export async function saveRecordingBlob(blob, opts) {
  const filename = opts.filename;
  const title = opts.title;
  const playerHost = opts.playerHost;
  const setStatus = opts.setStatus;

  if (!blob || blob.size === 0) {
    setStatus("Recording was empty — nothing saved.", true);
    return { outcome: "empty" };
  }

  const type = blob.type || "video/webm";
  const file = new File([blob], filename, { type });
  const files = [file];

  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title });
      setStatus("Shared recording (" + Math.round(blob.size / 1024) + " KB).");
      return { outcome: "shared" };
    }
  } catch (err) {
    if (!err || err.name !== "AbortError") {
      console.warn("share failed", err);
    }
  }

  showOnPagePlayer(blob, playerHost, setStatus);

  if (!isAndroidUA() && !isAppleTouchUA()) {
    lastDitchDownload(blob, filename);
  }

  return { outcome: "player" };
}
