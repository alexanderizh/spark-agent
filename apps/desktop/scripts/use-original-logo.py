"""Use the original Spark Tool logo (the PNG the user sent) as the source
of truth for every icon in the project. No re-design — we just resize it
and pack it into ICO/ICNS."""

import io
import struct
from pathlib import Path
from PIL import Image
import icnsutil

SRC = Path(r"G:\spark\spark-edugen\edu-web\public\7C730BC306E0F0EE19B94F87926C53EF.png")
ROOT = Path(r"G:\spark\spark-agent\apps\desktop\resources")


def load_original() -> Image.Image:
    img = Image.open(SRC).convert("RGBA")
    print(f"  Source: {SRC.name}  size={img.size}  mode={img.mode}")
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


def write_icns(img: Image.Image, out: Path, spec) -> None:
    f = icnsutil.IcnsFile()
    for s, key in spec:
        buf = io.BytesIO()
        img.resize((s, s), Image.LANCZOS).save(buf, format="PNG")
        f.add_media(key=key, data=buf.getvalue())
    f.write(str(out))
    print(f"  {out.name:20s} -> {[s for s, _ in spec]}")


def crop_symbol(img: Image.Image) -> Image.Image:
    """Crop the original image to just the infinity-symbol area.
    The wordmark and tagline are removed because they are unreadable at
    taskbar/tray/in-app title-bar sizes."""
    w, h = img.size
    # The symbol itself sits in roughly the middle 38% of the original.
    top = int(h * 0.20)
    bottom = int(h * 0.58)
    cropped = img.crop((0, top, w, bottom))
    cw, ch = cropped.size
    side = max(cw, ch)
    square = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    square.paste(cropped, ((side - cw) // 2, (side - ch) // 2), cropped)
    print(f"  cropped symbol    -> {square.size}")
    return square


def main():
    print("Using the original Spark Tool logo (no redesign).\n")
    original = load_original()
    symbol = crop_symbol(original)

    # Main app icon (1024, full logo including wordmark)
    save_png(original, ROOT / "icon.png", 1024)

    # Windows .ico (multi-size, full logo)
    write_ico(original, ROOT / "icon.ico", [16, 24, 32, 48, 64, 128, 256])

    # macOS .icns (multi-size, full logo)
    write_icns(original, ROOT / "icon.icns", [
        (16,  "icp4"),
        (32,  "icp5"),
        (64,  "icp6"),
        (128, "ic07"),
        (256, "ic08"),
        (512, "ic09"),
        (1024,"ic10"),
    ])

    # Taskbar & tray icons use the cropped SYMBOL only (text is unreadable small)
    save_png(symbol, ROOT / "taskbarIcon.png", 256)

    # Tray color (32x32) — symbol only
    save_png(symbol, ROOT / "trayIconWin.png", 32)

    # Tray template (32x32, alpha-only) — symbol only, black silhouette
    color = symbol.resize((32, 32), Image.LANCZOS)
    r, g, b, a = color.split()
    template = Image.merge("RGBA", (Image.new("L", color.size, 0),
                                    Image.new("L", color.size, 0),
                                    Image.new("L", color.size, 0),
                                    a))
    template.save(ROOT / "trayTemplate.png", optimize=True)
    print(f"  trayTemplate.png  -> 32x32 (alpha-only template)")

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
    print(f"  preview           -> {ROOT.parent}\\scripts\\icon-sizes.preview.png")

    print("\nDone.")


if __name__ == "__main__":
    main()
