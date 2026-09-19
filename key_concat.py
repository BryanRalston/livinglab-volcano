"""Key Beat A+B with chromakey=#00FF00, concat to webm+webp, write frame0."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

FFMPEG = Path(
    r"C:\Users\bryma\AppData\Local\Microsoft\WinGet\Packages"
    r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    r"\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe"
)
FFPROBE = FFMPEG.with_name("ffprobe.exe")
ROOT = Path(r"C:\Users\bryma\Temp\LivingLab")
A = ROOT / "assets" / "beatA_gs.mp4"
B = ROOT / "assets" / "beatB_gs.mp4"
KEYED = ROOT / "assets" / "keyed"
WEBM = KEYED / "eruption.webm"
WEBP = KEYED / "eruption.webp"
FRAME0 = KEYED / "eruption_frame0.png"
VF = "chromakey=0x00FF00:0.12:0.08,despill=type=green:mix=0.35:expand=0,format=rgba"


def run(cmd: list[str]) -> None:
    print(">", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2500:])
        raise SystemExit(r.returncode)


def probe(path: Path) -> dict:
    r = subprocess.run(
        [
            str(FFPROBE),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate,nb_frames,duration",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(r.stdout)


def corners(path: Path) -> list:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    return [im.getpixel(p) for p in [(8, 8), (w - 9, 8), (8, h - 9), (w - 9, h - 9)]]


def main() -> None:
    KEYED.mkdir(parents=True, exist_ok=True)
    pa, pb = probe(A), probe(B)
    print("probeA", pa)
    print("probeB", pb)

    # First keyed frame of Beat A
    run(
        [
            str(FFMPEG),
            "-y",
            "-i",
            str(A),
            "-vf",
            VF,
            "-frames:v",
            "1",
            "-update",
            "1",
            str(FRAME0),
        ]
    )
    print("frame0", FRAME0, FRAME0.stat().st_size)

    # Concat keyed A then B → VP9 yuva
    fc = (
        f"[0:v]{VF},fps=24,scale=1104:816[a];"
        f"[1:v]{VF},fps=24,scale=1104:816[b];"
        f"[a][b]concat=n=2:v=1:a=0[v]"
    )
    run(
        [
            str(FFMPEG),
            "-y",
            "-i",
            str(A),
            "-i",
            str(B),
            "-filter_complex",
            fc,
            "-map",
            "[v]",
            "-an",
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
            str(WEBM),
        ]
    )
    print("webm", WEBM, WEBM.stat().st_size)

    run(
        [
            str(FFMPEG),
            "-y",
            "-c:v",
            "libvpx-vp9",
            "-i",
            str(WEBM),
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
    )
    print("webp", WEBP, WEBP.stat().st_size)

    # Checker of frame0
    im = np.array(Image.open(FRAME0).convert("RGBA"))
    yy, xx = np.indices(im.shape[:2])
    tile = 24
    chk_on = ((xx // tile) + (yy // tile)) % 2 == 0
    chk = np.zeros_like(im)
    chk[chk_on] = (210, 210, 210, 255)
    chk[~chk_on] = (40, 40, 40, 255)
    a = im[:, :, 3:4].astype(np.float32) / 255.0
    comp = (im.astype(np.float32) * a + chk.astype(np.float32) * (1.0 - a)).astype(np.uint8)
    halo = KEYED / "halo_check_frame0.png"
    Image.fromarray(comp).save(halo)
    print("halo", halo)

    meta = {
        "beatA_duration": pa.get("format", {}).get("duration"),
        "beatB_duration": pb.get("format", {}).get("duration"),
        "webm_bytes": WEBM.stat().st_size,
        "webp_bytes": WEBP.stat().st_size,
    }
    (KEYED / "concat_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("OK", meta)


if __name__ == "__main__":
    main()
