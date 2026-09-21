/**
 * Shared MediaRecorder save path for Living Lab.
 * Stop shares a real File from the user gesture. Android Chrome only
 * accepts an exact MIME (video/webm or video/mp4) — a codec suffix such as
 * video/webm;codecs=vp9 is rejected, and the sheet never opens.
 * If share is unavailable or cancelled, show an on-page player and a
 * Save file control that writes a named file (File System Access API,
 * or share again on Android). Do not rely on a.download + blob: URLs there.
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
  // WebM before MP4. Android MediaRecorder mp4 often yields an empty file.
  // Android vp9 often writes a 0-byte webm; prefer vp8, then plain webm.
  const types = isAndroidUA()
    ? [
        "video/webm;codecs=vp8",
        "video/webm",
        "video/webm;codecs=vp9",
        "video/mp4",
      ]
    : [
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
  const raw = (mime || "").toLowerCase();
  if (raw.indexOf("png") >= 0 || raw.indexOf("image/") === 0) return ".png";
  return raw.indexOf("mp4") >= 0 ? ".mp4" : ".webm";
}

export function recordingFilename(prefix, mime) {
  return prefix + new Date().toISOString().replace(/[:.]/g, "-") + recorderExtension(mime);
}

/** Exact shareable type. Codec parameters are not in Chrome's permit list. */
export function shareableFileType(mime) {
  const raw = (mime || "").toLowerCase();
  if (raw.indexOf("png") >= 0 || raw.indexOf("image/") === 0) return "image/png";
  if (raw.indexOf("mp4") >= 0) return "video/mp4";
  return "video/webm";
}

export function recordingFile(blob, filename, mime) {
  const type = shareableFileType(mime || (blob && blob.type));
  const body = blob && blob.type === type ? blob : new Blob([blob], { type });
  return new File([body], filename, { type, lastModified: Date.now() });
}

function kbLabel(blob) {
  return Math.round(blob.size / 1024) + " KB";
}

function releasePlayerUrl(playerHost) {
  if (!playerHost || !playerHost._blobUrl) return;
  URL.revokeObjectURL(playerHost._blobUrl);
  playerHost._blobUrl = "";
}

function clearPlayer(playerHost) {
  if (!playerHost) return;
  releasePlayerUrl(playerHost);
  playerHost.hidden = true;
  playerHost.innerHTML = "";
}

/**
 * @returns {"shared"|"aborted"|"unavailable"|"failed"}
 */
async function shareFile(file, title) {
  if (!navigator.share || !navigator.canShare) return "unavailable";
  const files = [file];
  let allowed = false;
  try {
    allowed = navigator.canShare({ files });
  } catch (_) {
    return "unavailable";
  }
  if (!allowed) return "unavailable";
  try {
    await navigator.share({ files, title });
    return "shared";
  } catch (err) {
    if (err && err.name === "AbortError") return "aborted";
    console.warn("share failed", err);
    return "failed";
  }
}

function pickerTypes(type) {
  if (type === "image/png") {
    return [{ description: "PNG image", accept: { "image/png": [".png"] } }];
  }
  if (type === "video/mp4") {
    return [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }];
  }
  return [{ description: "WebM video", accept: { "video/webm": [".webm"] } }];
}

/**
 * @returns {"saved"|"aborted"|"unavailable"|"failed"}
 */
async function saveWithPicker(blob, filename, type) {
  if (typeof window.showSaveFilePicker !== "function") return "unavailable";
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: pickerTypes(type),
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  } catch (err) {
    if (err && err.name === "AbortError") return "aborted";
    console.warn("showSaveFilePicker failed", err);
    return "failed";
  }
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

function reportSaved(file, blob, setStatus) {
  setStatus("Saved " + file.name + " (" + kbLabel(blob) + ").");
}

function reportShared(file, blob, setStatus) {
  setStatus("Shared " + file.name + " (" + kbLabel(blob) + ").");
}

/**
 * Save file click. On Android this must call showSaveFilePicker or
 * navigator.share in the same turn as the tap — no await before that call.
 */
function onSaveFileClick(blob, file, title, setStatus) {
  const android = isAndroidUA();
  const canPick = typeof window.showSaveFilePicker === "function";

  if (android && canPick) {
    saveWithPicker(blob, file.name, file.type).then((result) => {
      if (result === "saved") {
        reportSaved(file, blob, setStatus);
        return;
      }
      if (result === "aborted") {
        setStatus("Save cancelled.");
        return;
      }
      setStatus("Could not write the file. Tap Save file again.", true);
    });
    return;
  }

  if (android) {
    shareFile(file, title).then((result) => {
      if (result === "shared") {
        reportShared(file, blob, setStatus);
        return;
      }
      if (result === "aborted") {
        setStatus("Save cancelled.");
        return;
      }
      setStatus("Could not save the file. Tap Save file and choose Files, Photos, Drive, or a chat.", true);
    });
    return;
  }

  if (canPick) {
    saveWithPicker(blob, file.name, file.type).then((result) => {
      if (result === "saved") {
        reportSaved(file, blob, setStatus);
        return;
      }
      if (result === "aborted") {
        setStatus("Save cancelled.");
        return;
      }
      lastDitchDownload(blob, file.name);
      setStatus("Downloading " + file.name + " (" + kbLabel(blob) + ").");
    });
    return;
  }

  let allowed = false;
  if (navigator.canShare) {
    try {
      allowed = navigator.canShare({ files: [file] });
    } catch (_) {
      allowed = false;
    }
  }
  if (allowed) {
    shareFile(file, title).then((result) => {
      if (result === "shared") {
        reportShared(file, blob, setStatus);
        return;
      }
      if (result === "aborted") {
        setStatus("Save cancelled.");
        return;
      }
      lastDitchDownload(blob, file.name);
      setStatus("Downloading " + file.name + " (" + kbLabel(blob) + ").");
    });
    return;
  }

  lastDitchDownload(blob, file.name);
  setStatus("Downloading " + file.name + " (" + kbLabel(blob) + ").");
}

function showOnPagePlayer(blob, file, title, playerHost, setStatus, readyStatus) {
  if (!playerHost) {
    setStatus(readyStatus || ("Recording ready (" + kbLabel(blob) + "). Tap Save file — the player is missing."), true);
    return;
  }
  releasePlayerUrl(playerHost);
  const url = URL.createObjectURL(blob);
  playerHost._blobUrl = url;
  playerHost.hidden = false;
  playerHost.innerHTML = "";

  const image = file.type === "image/png";
  let preview;
  if (image) {
    preview = document.createElement("img");
    preview.alt = "Snapshot of the craft volcano";
    preview.src = url;
  } else {
    preview = document.createElement("video");
    preview.controls = true;
    preview.playsInline = true;
    preview.setAttribute("playsinline", "");
    preview.controlsList = "nodownload";
    preview.setAttribute("controlsList", "nodownload");
    preview.src = url;
  }
  preview.className = "rec-player";

  const hint = document.createElement("p");
  hint.className = "hint";
  const ext = image ? ".png" : (file.type === "video/mp4" ? ".mp4" : ".webm");
  hint.textContent = "Tap Save file, then choose Files, Photos, Drive, or a chat. The clip is saved as a named " + ext + ".";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "rec-save";
  save.textContent = "Save file";
  save.addEventListener("click", () => {
    onSaveFileClick(blob, file, title, setStatus);
  });

  playerHost.append(preview, hint, save);
  setStatus(readyStatus || ("Recording ready (" + kbLabel(blob) + "). Tap Save file."));
}

/**
 * Call from the Stop click handler (same user-gesture) after MediaRecorder stops.
 * @param {Blob} blob
 * @param {{ filename: string, title: string, playerHost: HTMLElement, setStatus: Function, sharedStatus?: string, readyStatus?: string }} opts
 */
export async function saveRecordingBlob(blob, opts) {
  const filename = opts.filename;
  const title = opts.title;
  const playerHost = opts.playerHost;
  const setStatus = opts.setStatus;

  if (!blob || blob.size === 0) {
    clearPlayer(playerHost);
    setStatus("Recording was empty — nothing saved. Try again / longer record.", true);
    return { outcome: "empty" };
  }

  const file = recordingFile(blob, filename, blob.type);
  const shared = await shareFile(file, title);
  if (shared === "shared") {
    clearPlayer(playerHost);
    setStatus(opts.sharedStatus || ("Shared recording (" + kbLabel(blob) + ")."));
    return { outcome: "shared" };
  }

  showOnPagePlayer(blob, file, title, playerHost, setStatus, opts.readyStatus);
  if (shared === "aborted" && !opts.readyStatus) {
    setStatus("Share cancelled. Recording ready (" + kbLabel(blob) + "). Tap Save file.");
  }
  return { outcome: "player" };
}
