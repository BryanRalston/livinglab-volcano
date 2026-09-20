# Living Lab — Experiment Video Quality Standards

_Last updated 2026-09-19 from Kitchen Volcano AR (foam3 process + cups4)._

## Ownership

| Role | Owns |
|------|------|
| **Cut Room** | Imagine briefs, framing/aspect, GI regenerates, watch QC, ship-bar Yes/No, keyed deliverables |
| **Living Lab** | AR/page/WebXR, on-device composite path, wire-up + `?v=` bump |
| **Grok Interface** | Executes Build/Pages pushes Living Lab briefs; no twin sessions |

Living Lab does **not** drive Imagine beat sheets. Cut Room does **not** own on-device shaders.

---

## Current working AR process (do not regress)

**Locked stack (foam3 / cups4, live = classic3_steps):**

- WebXR in-page AR (not Scene Viewer for the Imagine plate)
- Place = RGBA still (`assets/keyed/classic3/place_frame0.png`)
- Pour baking soda = play-once `soda.webm`, freeze on last frame (`soda_end.png` OK)
- Pour vinegar = play-once `vinegar_erupt.webm` (includes foam), then freeze
- Material: `MeshBasicMaterial` + `alphaTest ≈ 0.25`
- **No** black-matte `ShaderMaterial` for the success path (that path caused green plate / fringe / thrash)
- classic1 `eruption.webm` / `eruption_frame0.png` may remain on disk unused

**On-page:** same stepped assets for Place / soda / vinegar / Replay; Why + quiz stay text.

---

## Deliverables Cut Room must ship

**Live (classic3_steps):**

1. `assets/keyed/classic3/place_frame0.png` — RGBA place still
2. `assets/keyed/classic3/soda.webm` — **true YUVA** (libvpx-vp9), play once
3. `assets/keyed/classic3/soda_end.png` — freeze after soda
4. `assets/keyed/classic3/vinegar_erupt.webm` — **true YUVA**, play once (vinegar + foam)
5. Optional dual: `soda_dual.webm`, `vinegar_erupt_dual.webm`
6. `assets/keyed/classic3/ALPHA_PROOF.txt` — decode proof commands + numbers

classic1 `eruption.webm` / `eruption_frame0.png` / `eruption_dual.webm` may remain unused.

### Alpha proof (mandatory before Yes)

`ffprobe` often reports `pix_fmt=yuv420p` even when alpha exists — **do not trust that alone**.

```bash
ffmpeg -c:v libvpx-vp9 -i eruption.webm -frames:v 1 -pix_fmt rgba prove.png
# corner alpha must be 0; transparent ~75%+ of frame
```

Default ffmpeg decode **without** `-c:v libvpx-vp9` strips alpha → false opaque/black (this is how cups2 black-plated on device/tools).

**Gate:** Living Lab will not wire until corner A=0 under libvpx-vp9 decode.

---

## Imagine capture rules

### Greenscreen

- Prefer pure `#00FF00` full floor + backdrop
- Document actual key RGB if not pure (dark green ~`RGB(1,134,37)` broke naive ffmpeg chromakey before)
- Full green floor under props (white table under white cups = unkeyable)

### Lighting & shadows (hard)

- **No contact shadows on the GS floor**
- **No cast shadows** under/beside cups or bowl
- Flat even light; subtle self-shading on ceramic OK
- Shadows, if wanted later, are added in AR by Living Lab — **not baked into the plate**

**Why:** Imagine floor shadows key as opaque black blobs (RGB 0,0,0 A=255) under props. cups3 failed this; cups4 passed with base dark-opaque ≈ 0%.

### Props / cups

- Floating cups — **no hands, arms, people**
- Both cups fully visible from **t=0** (parked L/R) — no pop-in
- **Not clear glass** — clear glass speculars get keyed out (“missing glass”)
- Use opaque / frosted / ceramic cups with a solid silhouette
- Short soda pour → vinegar → foam (pour→react experiments)
- Everything fully in frame — no cropped cup rims or foam kissing edges

### Framing & timing

- Aspect **4:3 @ 1104×816** (volcano lineage)
- Duration **~12–16s** (no stubs without end hold)
- ≥~80px headroom at max cup tilt; ≥~80px footroom under full foam
- After foam peaks: stop pour, park both cups, **true freeze ~4–6s**
- classic3 is play-once per step (not a looping Erupt plate)

---

## Key / matte rules

- Offline key → true alpha webm + RGBA still
- No green plate / solid green square left in frame
- No thick green fringe on rims
- Bowl + cups natural color (not mint/green cast from over-despill)
- **Base dark-opaque gate:** count of RGB≈0 & A=255 in bottom ~20% of subject ≈ **0** (compare foam3)

Avoid “nuclear despill” that paints ceramic green or eats glass. Prefer clean GS + gentle key.

---

## What failed (do not repeat)

| Failure | Cause | Lesson |
|---------|--------|--------|
| Scene Viewer “Couldn't load object” | BLEND + zero-scale flipbook + bad PNG | Prefer WebXR + keyed video plate |
| Green plate / thick fringe | Hot G-dominant key / despill (webxr18) | Don’t over-key; restore known-good |
| Mint bowl/glasses | Green cast baked into matte | Despill must keep R≥G≥B on props |
| Missing clear glass | Speculars keyed as background | No clear glass props |
| Black background / black plate | yuv420p webm under MeshBasic+alphaTest (no real alpha) | True YUVA + libvpx proof |
| Black blobs under bases | Imagine contact shadows on GS floor | Ban shadows in Imagine |
| “Getting worse” spiral | Checklist thrash after visual peak | Freeze process; one change at a time |

---

## Ship-ready checklist (Cut Room → Yes)

- [ ] True alpha webm (libvpx-vp9 prove: corner A=0)
- [ ] RGBA frame0, transparent corners
- [ ] 4:3 1104×816, duration ~12–16s
- [ ] Both cups from t=0 (if pour experiment)
- [ ] No hands; opaque cups; no clear glass
- [ ] No Imagine shadows / base dark-opaque ≈ 0%
- [ ] No green plate / thick fringe / mint cast
- [ ] Foam fully in frame; park + freeze ~4–6s
- [ ] ALPHA_PROOF.txt included
- [ ] Living Lab wires on foam3 stack only (`MeshBasic` + `alphaTest`)

---

## Living Lab wire rules

- Keep foam3 composite path unless Bryan explicitly changes process
- Bump `?v=` on every asset swap
- Verify with curl: tip `?v=`, webm size, no leftover cups/soda copy when foam-only
- If Samsung still blacks single-stream alpha → try `eruption_dual.webm` dual textures
- USDZ / iPhone Quick Look is a separate pass (capability route); don’t block video standards on it

---

## Known-good references

- **Process:** foam3 (`MeshBasic` + `alphaTest`, foam-only) — black plate gone
- **Cups + no shadows:** cups4 (pending Bryan on-device confirm)
- **Avoid as live tip:** cups2 (fake alpha / black plate), webxr18–21 despill/opaque spiral
