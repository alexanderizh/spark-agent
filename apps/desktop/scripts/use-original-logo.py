"""Use the user-provided Spark Tool logo PNGs as the source of truth.

Image #1 is the full app icon. Image #2 is the symbol-only source for
taskbar and tray assets, where wordmarks would be unreadable.
"""

import io
import struct
from pathlib import Path
from PIL import Image, ImageFilter

DESKTOP_ROOT = Path(__file__).resolve().parents[1]
ROOT = DESKTOP_ROOT / "resources"
RENDERER_ASSETS = DESKTOP_ROOT / "src" / "renderer" / "assets"
APP_ICON_SRC = ROOT / "source" / "app-icon-source.png"
SYMBOL_SRC = ROOT / "source" / "tray-symbol-source.png"


def load_source(path: Path, label: str) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    print(f"  {label}: {path.name}  size={img.size}  mode={img.mode}")
    return img


def save_png(img: Image.Image, out: Path, size: int) -> None:
    out_img = img.resize((size, size), Image.LANCZOS)
    out_img.save(out, format="PNG", optimize=True)
    print(f"  {out.name:20s} -> {size}x{size}")


def write_ico(img: Image.Image, out: Path, sizes) -> None:
    payloads = []
    for s in sizes:
        buf = io.BytesIO()
        img.resize((s, s), Image.LANCZOS).save(buf, format="PNG")
        payloads.append(buf.getvalue())
    entries = []
    for s, png in zip(sizes, payloads):
        w = 0 if s == 256 else s
        h = 0 if s == 256 else s
        entries.append(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(png), 0))
    base = 6 + 16 * len(sizes)
    for i, png in enumerate(payloads):
        w, h, c, r, p, b, sz, _ = struct.unpack("<BBBBHHII", entries[i])
        entries[i] = struct.pack("<BBBBHHII", w, h, c, r, p, b, sz, base + sum(len(x) for x in payloads[:i]))
    out.write_bytes(struct.pack("<HHH", 0, 1, len(sizes)) + b"".join(entries) + b"".join(payloads))
    print(f"  {out.name:20s} -> {sizes} ({out.stat().st_size} bytes)")


def write_icns(img: Image.Image, out: Path) -> None:
    specs = [
        ("icp4", 16),
        ("icp5", 32),
        ("icp6", 64),
        ("ic07", 128),
        ("ic08", 256),
        ("ic09", 512),
        ("ic10", 1024),
    ]
    chunks = []
    for key, size in specs:
        buf = io.BytesIO()
        img.resize((size, size), Image.LANCZOS).save(buf, format="PNG")
        payload = buf.getvalue()
        chunks.append(key.encode("ascii") + struct.pack(">I", len(payload) + 8) + payload)

    body = b"".join(chunks)
    out.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)
    print(f"  {out.name:20s} -> {[size for _, size in specs]}")


def isolate_symbol(img: Image.Image, pad_ratio: float = 0.12) -> Image.Image:
    """Remove the light checkerboard/white background and keep the mark."""
    rgba = img.convert("RGBA")
    mask = Image.new("L", rgba.size, 0)
    src_px = rgba.load()
    mask_px = mask.load()

    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _a = src_px[x, y]
            distance_from_light_bg = ((246 - r) ** 2 + (246 - g) ** 2 + (246 - b) ** 2) ** 0.5
            mask_px[x, y] = max(0, min(255, int((distance_from_light_bg - 42) * 4.0)))

    bbox = mask.getbbox()
    if bbox is None:
        raise RuntimeError("Could not find symbol pixels in source image")

    left, top, right, bottom = bbox
    pad = int(max(right - left, bottom - top) * pad_ratio)
    box = (
        max(0, left - pad),
        max(0, top - pad),
        min(rgba.width, right + pad),
        min(rgba.height, bottom + pad),
    )
    cropped = rgba.crop(box)
    mask = mask.crop(box).filter(ImageFilter.GaussianBlur(0.4))
    cropped.putalpha(mask)

    cw, ch = cropped.size
    side = max(cw, ch)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, ((side - cw) // 2, (side - ch) // 2), cropped)
    print(f"  isolated symbol   -> {square.size}")
    return square


def main():
    print("Using the user-provided Spark Tool logo assets.\n")
    original = load_source(APP_ICON_SRC, "App icon")
    symbol = isolate_symbol(load_source(SYMBOL_SRC, "Tray/taskbar symbol"))

    # Main app icon (1024, full logo including wordmark)
    save_png(original, ROOT / "icon.png", 1024)

    # Windows .ico (multi-size, full logo)
    write_ico(original, ROOT / "icon.ico", [16, 24, 32, 48, 64, 128, 256])

    # macOS .icns (multi-size, full logo)
    write_icns(original, ROOT / "icon.icns")

    # Taskbar & tray icons use the cropped SYMBOL only (text is unreadable small)
    save_png(symbol, ROOT / "taskbarIcon.png", 256)
    save_png(symbol, RENDERER_ASSETS / "spark-logo.png", 256)

    # Tray color — symbol only. Stored at 64px so Electron can downscale
    # cleanly for Windows/Linux DPI variants.
    save_png(symbol, ROOT / "trayIconWin.png", 64)

    # Tray template (64x64, alpha-only) — symbol only, black silhouette
    color = symbol.resize((64, 64), Image.LANCZOS)
    r, g, b, a = color.split()
    template = Image.merge("RGBA", (Image.new("L", color.size, 0),
                                    Image.new("L", color.size, 0),
                                    Image.new("L", color.size, 0),
                                    a))
    template.save(ROOT / "trayTemplate.png", optimize=True)
    print(f"  trayTemplate.png  -> 64x64 (alpha-only template)")

    # Side-by-side preview for visual check
    sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    gap = 20
    total_w = sum(sizes) + gap * (len(sizes) - 1)
    max_h = max(sizes)
    preview = Image.new("RGBA", (total_w, max_h), (60, 60, 60, 255))
    x = 0
    for s in sizes:
        thumb = original.resize((s, s), Image.LANCZOS)
        preview.paste(thumb, (x, max_h - s), thumb)
        x += s + gap
    preview.save(ROOT.parent / "scripts" / "icon-sizes.preview.png")
    print(f"  preview           -> {ROOT.parent / 'scripts' / 'icon-sizes.preview.png'}")

    print("\nDone.")


if __name__ == "__main__":
    main()
