"""Printable 8.5x11 lab mat: black placement circle, bowl-scale."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

out = Path(r"C:\Users\bryma\Temp\LivingLab\assets\lab-mat.png")
# 8.5 x 11 in at 150 dpi — printable, not huge
W, H = 1275, 1650
im = Image.new("RGB", (W, H), (252, 248, 240))
d = ImageDraw.Draw(im)

try:
    font_lg = ImageFont.truetype("C:\\Windows\\Fonts\\segoeui.ttf", 56)
    font_md = ImageFont.truetype("C:\\Windows\\Fonts\\segoeui.ttf", 36)
    font_sm = ImageFont.truetype("C:\\Windows\\Fonts\\segoeui.ttf", 28)
except OSError:
    font_lg = font_md = font_sm = ImageFont.load_default()

d.rectangle([40, 40, W - 40, H - 40], outline=(20, 20, 20), width=8)
d.text((W // 2, 90), "LIVING LAB", fill=(20, 20, 20), font=font_lg, anchor="mm")
d.text((W // 2, 160), "Kitchen Volcano", fill=(80, 50, 30), font=font_md, anchor="mm")
d.text((W // 2, 220), "Print this page. Lay it on the table.", fill=(40, 40, 40), font=font_sm, anchor="mm")

# 20 cm circle at 150 dpi: 20/2.54 * 150 ≈ 1181 px diameter — too big for page.
# Use 12 cm visual target (~709 px) labeled "bowl goes here".
cx, cy = W // 2, H // 2 + 40
r = 340
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(0, 0, 0), width=18)
d.ellipse([cx - r + 28, cy - r + 28, cx + r - 28, cy + r - 28], outline=(0, 0, 0), width=4)
d.text((cx, cy - 20), "SET BOWL HERE", fill=(0, 0, 0), font=font_md, anchor="mm")
d.text((cx, cy + 30), "then tap View in AR", fill=(60, 60, 60), font=font_sm, anchor="mm")

d.text(
    (W // 2, H - 120),
    "Phone on the table. AR button. Place the volcano on the circle.",
    fill=(40, 40, 40),
    font=font_sm,
    anchor="mm",
)
d.text((W // 2, H - 70), "Living Lab  ·  baking soda + vinegar", fill=(90, 90, 90), font=font_sm, anchor="mm")
im.save(out, "PNG", optimize=True)
print("wrote", out, out.stat().st_size)
