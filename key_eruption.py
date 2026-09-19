"""Chroma-key eruption_gs.mp4 (#00FF00) to VP9 WebM + animated WebP + PNG samples."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(r"C:\Users\bryma\Temp\LivingLab")
SRC = ROOT / "assets" / "eruption_gs.mp4"
KEYED = ROOT / "assets" / "keyed"
FFMPEG = Path(
    r"C:\Users\bryma\AppData\Local\Microsoft\WinGet\Packages"
    r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    r"\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe"
)
PNG_DIR = KEYED / "png"
WEBM = KEYED / "eruption.webm"
WEBP = KEYED / "eruption.webp"


def sample_corners(bgr: np.ndarray) -> dict:
    h, w = bgr.shape[:2]
    pts = {
        "tl": bgr[8, 8],
        "tr": bgr[8, w - 9],
        "bl": bgr[h - 9, 8],
        "br": bgr[h - 9, w - 9],
        "topmid": bgr[8, w // 2],
    }
    out = {}
    for name, px in pts.items():
        b, g, r = (int(px[0]), int(px[1]), int(px[2]))
        out[name] = (r, g, b)
    return out


def key_frame(bgr: np.ndarray) -> np.ndarray:
    """Return BGRA uint8. Soft-key near #00FF00, despill leftover green on foam."""
    bgr_f = bgr.astype(np.float32)
    b, g, r = cv2.split(bgr_f)

    # Distance from pure chroma green and green-dominance (screen vs subject).
    dist = np.sqrt((r - 0.0) ** 2 + (g - 255.0) ** 2 + (b - 0.0) ** 2)
    greenness = g - np.maximum(r, b)

    # Fully transparent when close to #00FF00; opaque on bowl/foam.
    # dist of #00FF00 is 0; a mid gray is ~220; white foam ~255 from green in RGB space.
    t_lo, t_hi = 42.0, 95.0
    alpha_dist = np.clip((dist - t_lo) / (t_hi - t_lo), 0.0, 1.0)
    a_green = np.clip((58.0 - greenness) / 28.0, 0.0, 1.0)
    alpha = np.minimum(alpha_dist, a_green)

    # Kill residual screen specks.
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    screen = (h >= 35) & (h <= 95) & (s >= 90) & (v >= 70) & (greenness > 40)
    alpha = np.where(screen, alpha * 0.15, alpha)
    alpha = np.clip(alpha, 0.0, 1.0)

    # Despill: pull G down toward max(R,B) on semi-transparent and near-green pixels.
    max_rb = np.maximum(r, b)
    mix = np.clip(greenness / 80.0, 0.0, 1.0) * (1.0 - alpha * 0.35)
    g2 = g * (1.0 - mix) + max_rb * mix

    # Soften the matte edge a touch.
    a8 = (alpha * 255.0).astype(np.uint8)
    a8 = cv2.GaussianBlur(a8, (3, 3), 0)
    alpha = a8.astype(np.float32) / 255.0

    out = np.dstack(
        [
            np.clip(b, 0, 255),
            np.clip(g2, 0, 255),
            np.clip(r, 0, 255),
            np.clip(alpha * 255.0, 0, 255),
        ]
    ).astype(np.uint8)
    return out


def halo_metrics(bgra: np.ndarray) -> dict:
    a = bgra[:, :, 3].astype(np.float32) / 255.0
    b, g, r = bgra[:, :, 0], bgra[:, :, 1], bgra[:, :, 2]
    edge = (a > 0.12) & (a < 0.88)
    if not np.any(edge):
        return {"edge_px": 0, "mean_greenness_edge": 0.0, "opaque_frac": float((a > 0.5).mean())}
    greenness = g.astype(np.float32) - np.maximum(r.astype(np.float32), b.astype(np.float32))
    return {
        "edge_px": int(edge.sum()),
        "mean_greenness_edge": float(greenness[edge].mean()),
        "opaque_frac": float((a > 0.5).mean()),
        "transparent_frac": float((a < 0.08).mean()),
    }


def main() -> int:
    KEYED.mkdir(parents=True, exist_ok=True)
    PNG_DIR.mkdir(parents=True, exist_ok=True)
    if not SRC.exists():
        print("MISSING", SRC)
        return 1

    cap = cv2.VideoCapture(str(SRC))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"src {SRC} {w}x{h} fps={fps} frames={n}")

    frames_bgra = []
    sample_idx = {0, max(0, int(fps * 0.5)), max(0, int(fps * 4)), max(0, int(fps * 8)), max(0, n - 1)}
    i = 0
    first_corners = None
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if i == 0:
            first_corners = sample_corners(bgr)
            print("corner_rgb", first_corners)
        bgra = key_frame(bgr)
        frames_bgra.append(bgra)
        png_path = PNG_DIR / f"frame_{i:04d}.png"
        cv2.imwrite(str(png_path), bgra)
        if i in sample_idx:
            sample = KEYED / f"sample_{i:04d}.png"
            cv2.imwrite(str(sample), bgra)
            print("sample", sample.name, halo_metrics(bgra))
        i += 1
        if i % 24 == 0:
            print(f"keyed {i}/{n}")
    cap.release()
    print(f"wrote {i} png frames")

    # Pack VP9 with alpha from PNG sequence.
    cmd_webm = [
        str(FFMPEG),
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(PNG_DIR / "frame_%04d.png"),
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-b:v",
        "0",
        "-crf",
        "32",
        "-an",
        str(WEBM),
    ]
    print("ffmpeg webm", " ".join(cmd_webm))
    r = subprocess.run(cmd_webm, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:])
        return r.returncode
    print("webm", WEBM, WEBM.stat().st_size)

    # Animated WebP with alpha for iOS Safari.
    # Scale to 720 wide to keep the file phone-friendly.
    cmd_webp = [
        str(FFMPEG),
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(PNG_DIR / "frame_%04d.png"),
        "-vf",
        "scale=720:-1:flags=lanczos,format=rgba",
        "-an",
        "-c:v",
        "libwebp_anim",
        "-lossless",
        "0",
        "-quality",
        "72",
        "-compression_level",
        "4",
        "-loop",
        "0",
        str(WEBP),
    ]
    print("ffmpeg webp", " ".join(cmd_webp))
    r = subprocess.run(cmd_webp, capture_output=True, text=True)
    if r.returncode != 0:
        print("webp failed, trying libwebp")
        print(r.stderr[-1500:])
        cmd_webp[cmd_webp.index("libwebp_anim")] = "libwebp"
        r = subprocess.run(cmd_webp, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stderr[-1500:])
            print("WARN webp encode failed; webm still shipped")
        else:
            print("webp", WEBP, WEBP.stat().st_size)
    else:
        print("webp", WEBP, WEBP.stat().st_size)

    # Checker composite of mid sample for halo judgment.
    mid = KEYED / f"sample_{max(0, int(fps * 4)):04d}.png"
    if mid.exists():
        im = np.array(Image.open(mid).convert("RGBA"))
        yy, xx = np.indices(im.shape[:2])
        tile = 24
        chk_on = ((xx // tile) + (yy // tile)) % 2 == 0
        chk = np.zeros_like(im)
        chk[chk_on] = (210, 210, 210, 255)
        chk[~chk_on] = (40, 40, 40, 255)
        a = im[:, :, 3:4].astype(np.float32) / 255.0
        comp = (im.astype(np.float32) * a + chk.astype(np.float32) * (1.0 - a)).astype(np.uint8)
        comp_path = KEYED / "halo_check_mid.png"
        Image.fromarray(comp).save(comp_path)
        print("halo_check", comp_path)

    return 0


if __name__ == "__main__":
    sys.exit(main())
