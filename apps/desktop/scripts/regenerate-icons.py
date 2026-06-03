"""Regenerate Spark Tool icon assets using Pillow (no cairosvg dependency).

Outputs to apps/desktop/resources/:
  - icon.png            (1024x1024 master)
  - icon.ico            (multi-res: 16, 24, 32, 48, 64, 128, 256)
  - icon.icns           (multi-res: 16, 32, 64, 128, 256, 512, 1024)
  - taskbarIcon.png     (256x256)
  - trayTemplate.png    (32x32 alpha-only black template, for macOS)
  - trayIconWin.png     (32x32 color, for Windows)

The matching .svg source files are also rewritten.
"""
import io
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

try:
    import icnsutil
except ModuleNotFoundError:
    icnsutil = None

DESKTOP_ROOT = Path(__file__).resolve().parents[1]
ROOT = DESKTOP_ROOT / "resources"
TRAY_LOGO_SOURCE = DESKTOP_ROOT / "src" / "renderer" / "assets" / "spark-logo.png"

# ---------------------------------------------------------------------------
# Drawing primitives
# ---------------------------------------------------------------------------
def make_canvas(size: int) -> Image.Image:
    return Image.new("RGBA", (size, size), (0, 0, 0, 0))


def gradient(size: int, stops: list, diagonal: bool = True) -> Image.Image:
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = base.load()
    for y in range(size):
        for x in range(size):
            if diagonal:
                t = (x + y) / (2 * (size - 1))
            else:
                t = y / (size - 1)
            t = max(0.0, min(1.0, t))
            for i in range(len(stops) - 1):
                o1, c1 = stops[i]
                o2, c2 = stops[i + 1]
                if o1 <= t <= o2:
                    local = (t - o1) / (o2 - o1) if o2 > o1 else 0.0
                    r = int(c1[0] + (c2[0] - c1[0]) * local)
                    g = int(c1[1] + (c2[1] - c1[1]) * local)
                    b = int(c1[2] + (c2[2] - c1[2]) * local)
                    px[x, y] = (r, g, b, 255)
                    break
    return base


def vertical_gradient_alpha(size: int, top_alpha: float, bottom_alpha: float = 0.0) -> Image.Image:
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = base.load()
    for y in range(size):
        t = y / (size - 1)
        a = int((top_alpha + (bottom_alpha - top_alpha) * t) * 255)
        for x in range(size):
            px[x, y] = (255, 255, 255, a)
    return base


def radial_dark_bg(size: int) -> Image.Image:
    """Legacy alias kept for backward compatibility with prior icon design.

    The Spark Tool brand uses a warm cream background, so this is now unused
    by render_master(); the cream gradient is rendered by radial_cream_bg().
    """
    return radial_cream_bg(size)


def radial_cream_bg(size: int) -> Image.Image:
    """Warm cream/off-white rounded background — matches the reference image."""
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = base.load()
    cx, cy = size / 2, size * 0.42
    max_r = size * 0.85
    # F8F4EA (light cream center) -> EFE7D5 (warmer cream edge)
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            t = min(1.0, d / max_r)
            r = int(248 + (239 - 248) * t)
            g = int(244 + (231 - 244) * t)
            b = int(234 + (213 - 234) * t)
            px[x, y] = (r, g, b, 255)
    return base


def ring_mask(size: int, cx, cy, r_out, r_in):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.ellipse((cx - r_out, cy - r_out, cx + r_out, cy + r_out), fill=255)
    d.ellipse((cx - r_in, cy - r_in, cx + r_in, cy + r_in), fill=0)
    return m


# ---------------------------------------------------------------------------
# Master renderer — 1024x1024 with the new Spark Tool infinity design
# ---------------------------------------------------------------------------
def render_master(size: int) -> Image.Image:
    s = size
    img = make_canvas(s)

    def u(v):
        # 1024-grid units -> actual pixels
        return int(round(v * s / 1024))

    # 1. Rounded cream background (the brand sits on warm off-white, like
    #    the reference image).
    bg = radial_cream_bg(s)
    bg_mask = Image.new("L", (s, s), 0)
    bmd = ImageDraw.Draw(bg_mask)
    radius = u(220)
    bmd.rounded_rectangle((0, 0, s - 1, s - 1), radius=radius, fill=255)
    bg.putalpha(bg_mask)

    # Soft drop shadow under the symbol — drawn first, then masked by the bg
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse((u(220), u(680), u(804), u(840)), fill=(40, 30, 20, 130))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=u(40)))
    bg.alpha_composite(shadow)

    img.alpha_composite(bg)

    # 2. Geometry — two horizontally-offset rings forming an infinity
    LEFT_CX, LEFT_CY = u(372), u(512)
    RIGHT_CX, RIGHT_CY = u(652), u(512)
    OUTER = u(200)
    INNER = u(130)

    # Ring-anchored gradient for the right ring (top-left blue -> bottom-right
    # orange) so the ring shows the full spectrum regardless of canvas size.
    def build_ring_gradient() -> Image.Image:
        rb_w = 2 * OUTER
        small = gradient(rb_w, [
            (0.0,  (59, 130, 246)),
            (0.33, (139, 92, 246)),
            (0.66, (236, 72, 153)),
            (1.0,  (249, 115, 22)),
        ], diagonal=True)
        full = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        full.paste(small, (RIGHT_CX - OUTER, RIGHT_CY - OUTER))
        return full

    grad = build_ring_gradient()

    # 3. Right ring soft outer glow (subtle, since we are on light bg now)
    glow_mask = ring_mask(s, RIGHT_CX, RIGHT_CY, OUTER + u(28), INNER - u(12))
    glow_layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    glow_layer.paste(grad, (0, 0), glow_mask)
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=u(28)))
    img.alpha_composite(glow_layer)

    # 4. The two main rings
    #    Left ring: solid dark (slate, slightly bluer than pure black so it
    #    doesn't read as a hole on the cream background)
    img.paste(
        Image.new("RGBA", (s, s), (24, 24, 32, 255)),
        (0, 0),
        ring_mask(s, LEFT_CX, LEFT_CY, OUTER, INNER),
    )
    img.paste(
        grad,
        (0, 0),
        ring_mask(s, RIGHT_CX, RIGHT_CY, OUTER, INNER),
    )

    # 5. Top-edge inner highlight on each ring (3D feel)
    band = vertical_gradient_alpha(s, top_alpha=0.45, bottom_alpha=0.0)
    highlight = Image.new("RGBA", (s, s), (255, 255, 255, 0))
    for cx, cy in [(LEFT_CX, LEFT_CY), (RIGHT_CX, RIGHT_CY)]:
        m = Image.new("L", (s, s), 0)
        d = ImageDraw.Draw(m)
        d.ellipse((cx - OUTER, cy - OUTER, cx + OUTER, cy + OUTER), fill=255)
        d.ellipse((cx - INNER, cy - INNER, cx + INNER, cy + INNER), fill=0)
        d.rectangle((cx - OUTER, cy, cx + OUTER, cy + OUTER), fill=0)
        h = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        h.paste(band, (0, 0), m)
        highlight.alpha_composite(h)
    img.alpha_composite(highlight)

    # 6. Soft dark "knot" tint where the two rings overlap (interlocking feel)
    #    On a cream bg we use a subtle warm-dark overlay rather than a
    #    pure-black shadow.
    knot_mask = Image.new("L", (s, s), 0)
    kd = ImageDraw.Draw(knot_mask)
    kd.ellipse((s // 2 - u(70), s // 2 - u(170), s // 2 + u(70), s // 2 + u(170)), fill=140)
    knot = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    knot.paste(Image.new("RGBA", (s, s), (40, 30, 20, 255)), (0, 0), knot_mask)
    knot = knot.filter(ImageFilter.GaussianBlur(radius=u(10)))
    img.alpha_composite(knot)

    return img


# ---------------------------------------------------------------------------
# Tray (color, no background) — for Windows tray
# ---------------------------------------------------------------------------
def render_tray_color(size: int = 32) -> Image.Image:
    source = Image.open(TRAY_LOGO_SOURCE).convert("RGBA")
    mask = Image.new("L", source.size, 0)
    src_px = source.load()
    mask_px = mask.load()

    for y in range(source.height):
        for x in range(source.width):
            r, g, b, _a = src_px[x, y]
            distance_from_white = ((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2) ** 0.5
            mask_px[x, y] = max(0, min(255, int((distance_from_white - 34) * 4.2)))

    bbox = mask.getbbox()
    if bbox is None:
        return make_canvas(size)

    left, top, right, bottom = bbox
    pad = 8
    box = (
        max(0, left - pad),
        max(0, top - pad),
        min(source.width, right + pad),
        min(source.height, bottom + pad),
    )
    source = source.crop(box)
    mask = mask.crop(box).filter(ImageFilter.GaussianBlur(0.4))

    max_width = size - 2
    max_height = max(1, round(size * 0.69))
    scale = min(max_width / source.width, max_height / source.height)
    resized_size = (
        max(1, round(source.width * scale)),
        max(1, round(source.height * scale)),
    )
    source = source.resize(resized_size, Image.LANCZOS)
    mask = mask.resize(resized_size, Image.LANCZOS)

    result = make_canvas(size)
    alpha = Image.new("L", (size, size), 0)
    position = ((size - resized_size[0]) // 2, (size - resized_size[1]) // 2)
    result.paste(source, position)
    alpha.paste(mask, position)
    result.putalpha(alpha)
    return result


# ---------------------------------------------------------------------------
# macOS tray template — black silhouette, alpha carries the shape
# ---------------------------------------------------------------------------
def render_tray_template(size: int = 32) -> Image.Image:
    color = render_tray_color(size)
    r, g, b, a = color.split()
    return Image.merge("RGBA", (Image.new("L", color.size, 0),
                                 Image.new("L", color.size, 0),
                                 Image.new("L", color.size, 0),
                                 a))


# ---------------------------------------------------------------------------
# Taskbar icon — 256x256, full detail
# ---------------------------------------------------------------------------
def render_taskbar(size: int = 256) -> Image.Image:
    return render_master(size)


# ---------------------------------------------------------------------------
# SVG sources
# ---------------------------------------------------------------------------
SVG_MASTER = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="sparkRightGrad" x1="0.05" y1="0.20" x2="0.95" y2="0.85">
      <stop offset="0%"   stop-color="#3B82F6"/>
      <stop offset="33%"  stop-color="#8B5CF6"/>
      <stop offset="66%"  stop-color="#EC4899"/>
      <stop offset="100%" stop-color="#F97316"/>
    </linearGradient>
    <radialGradient id="sparkBg" cx="0.5" cy="0.42" r="0.85">
      <stop offset="0%"   stop-color="#F8F4EA"/>
      <stop offset="100%" stop-color="#EFE7D5"/>
    </radialGradient>
    <filter id="rightGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="28"/>
    </filter>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="22"/>
      <feOffset dx="0" dy="14"/>
      <feColorMatrix type="matrix"
        values="0 0 0 0 0.16
                0 0 0 0 0.12
                0 0 0 0 0.08
                0 0 0 0.45 0"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Rounded cream background -->
  <rect x="0" y="0" width="1024" height="1024" rx="220" ry="220" fill="url(#sparkBg)"/>

  <!-- Soft drop shadow under the symbol -->
  <ellipse cx="512" cy="760" rx="280" ry="40" fill="#3A2E1E" opacity="0.30" filter="url(#rightGlow)"/>

  <!-- Right (gradient) outer glow -->
  <g opacity="0.70" filter="url(#rightGlow)">
    <path d="M 652 332 a 220 220 0 1 0 0.001 0 Z M 652 412 a 110 110 0 1 1 -0.001 0 Z"
          fill="url(#sparkRightGrad)" fill-rule="evenodd"/>
  </g>

  <!-- Left ring (dark slate, slightly bluer than pure black) -->
  <path d="M 372 332 a 200 200 0 1 0 0.001 0 Z M 372 412 a 130 130 0 1 1 -0.001 0 Z"
        fill="#181820" fill-rule="evenodd"/>

  <!-- Right ring (gradient) -->
  <path d="M 652 332 a 200 200 0 1 0 0.001 0 Z M 652 412 a 130 130 0 1 1 -0.001 0 Z"
        fill="url(#sparkRightGrad)" fill-rule="evenodd"/>

  <!-- Top-edge inner highlight on each ring (3D feel) -->
  <path d="M 372 412 a 130 130 0 1 0 0.001 0 Z"
        fill="none" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="50" stroke-linecap="round"/>
  <path d="M 652 412 a 130 130 0 1 0 0.001 0 Z"
        fill="none" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="50" stroke-linecap="round"/>

  <!-- Soft dark "knot" tint where the two rings meet -->
  <ellipse cx="512" cy="512" rx="70" ry="180" fill="#3A2E1E" opacity="0.35" filter="url(#rightGlow)"/>
</svg>
"""

SVG_TASKBAR = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="g" x1="0.05" y1="0.20" x2="0.95" y2="0.85">
      <stop offset="0%"   stop-color="#3B82F6"/>
      <stop offset="33%"  stop-color="#8B5CF6"/>
      <stop offset="66%"  stop-color="#EC4899"/>
      <stop offset="100%" stop-color="#F97316"/>
    </linearGradient>
    <radialGradient id="bg" cx="0.5" cy="0.42" r="0.85">
      <stop offset="0%"   stop-color="#F8F4EA"/>
      <stop offset="100%" stop-color="#EFE7D5"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="256" height="256" rx="55" fill="url(#bg)"/>
  <g fill-rule="evenodd">
    <path d="M 93 81 a 50 50 0 1 0 0.001 0 Z M 93 98.5 a 32.5 32.5 0 1 1 -0.001 0 Z" fill="#181820"/>
    <path d="M 163 81 a 50 50 0 1 0 0.001 0 Z M 163 98.5 a 32.5 32.5 0 1 1 -0.001 0 Z" fill="url(#g)"/>
  </g>
  <ellipse cx="128" cy="128" rx="18" ry="45" fill="#3A2E1E" opacity="0.30"/>
</svg>
"""

SVG_TRAY_WIN = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <linearGradient id="g" x1="0.05" y1="0.20" x2="0.95" y2="0.85">
      <stop offset="0%"   stop-color="#3B82F6"/>
      <stop offset="33%"  stop-color="#8B5CF6"/>
      <stop offset="66%"  stop-color="#EC4899"/>
      <stop offset="100%" stop-color="#F97316"/>
    </linearGradient>
  </defs>
  <g fill-rule="evenodd">
    <path d="M 11.6 9.4 a 5.6 5.6 0 1 0 0.001 0 Z M 11.6 12.1 a 2.9 2.9 0 1 1 -0.001 0 Z" fill="#181820"/>
    <path d="M 20.4 9.4 a 5.6 5.6 0 1 0 0.001 0 Z M 20.4 12.1 a 2.9 2.9 0 1 1 -0.001 0 Z" fill="url(#g)"/>
  </g>
  <ellipse cx="16" cy="16" rx="2" ry="5.5" fill="#3A2E1E" opacity="0.35"/>
</svg>
"""

SVG_TRAY_TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <!-- macOS template image: black silhouette, alpha carries the shape. -->
  <g fill="#000" fill-rule="evenodd">
    <path d="M 11.6 9.4 a 5.6 5.6 0 1 0 0.001 0 Z M 11.6 12.1 a 2.9 2.9 0 1 1 -0.001 0 Z"/>
    <path d="M 20.4 9.4 a 5.6 5.6 0 1 0 0.001 0 Z M 20.4 12.1 a 2.9 2.9 0 1 1 -0.001 0 Z"/>
  </g>
  <ellipse cx="16" cy="16" rx="2" ry="5.5" fill="#000" opacity="0.35"/>
</svg>
"""


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
def downscale(src: Image.Image, size: int) -> Image.Image:
    return src.resize((size, size), Image.LANCZOS)


def main():
    print("Rendering Spark Tool icons...\n")

    master_1024 = render_master(1024)
    master_1024.save(ROOT / "icon.png", optimize=True)
    print(f"  icon.png        -> 1024x1024")

    # ICO (Windows) — build the multi-resolution file by hand.
    # PIL's ICO save with `sizes=[...]` only writes the first image when the
    # source is RGBA; we need to assemble a proper ICONDIR + ICONDIRENTRYs.
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_imgs = [downscale(master_1024, s) for s in ico_sizes]

    import struct

    def png_bytes(img: Image.Image) -> bytes:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    entries = []
    payloads = []
    for s, img in zip(ico_sizes, ico_imgs):
        png = png_bytes(img)
        w = 0 if s == 256 else s
        h = 0 if s == 256 else s
        # BITMAPINFOHEADER-encoded PNG ICO entries use 32 bpp.
        entries.append(struct.pack(
            "<BBBBHHII",
            w, h, 0, 0, 1, 32, len(png), 6 + 16 * len(ico_sizes),
        ))
        payloads.append(png)
    # Adjust offsets
    base = 6 + 16 * len(ico_sizes)
    for i, _ in enumerate(payloads):
        w, h, _c, _r, _pl, _bpp, size, _ = struct.unpack("<BBBBHHII", entries[i])
        new_offset = base + sum(len(p) for p in payloads[:i])
        entries[i] = struct.pack(
            "<BBBBHHII", w, h, _c, _r, _pl, _bpp, size, new_offset
        )

    ico_bytes = struct.pack("<HHH", 0, 1, len(ico_sizes)) + b"".join(entries) + b"".join(payloads)
    (ROOT / "icon.ico").write_bytes(ico_bytes)
    print(f"  icon.ico        -> {ico_sizes} ({len(ico_bytes)} bytes)")

    # ICNS (macOS) — use the standard PNG type codes.
    # icp4=16, icp5=32, icp6=48, ic07=128, ic08=256, ic09=512, ic10=1024.
    # For 64 we use icp6 with a 64x64 PNG (icnsutil passes it through).
    icns_spec = [
        (16,  "icp4"),
        (32,  "icp5"),
        (64,  "icp6"),
        (128, "ic07"),
        (256, "ic08"),
        (512, "ic09"),
        (1024,"ic10"),
    ]
    if icnsutil is None:
        print("  icon.icns       -> skipped (install icnsutil to regenerate)")
    else:
        icns_file = icnsutil.IcnsFile()
        for s, key in icns_spec:
            img = downscale(master_1024, s)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            icns_file.add_media(key=key, data=buf.getvalue())
        icns_file.write(str(ROOT / "icon.icns"))
        print(f"  icon.icns       -> {[s for s, _ in icns_spec]}")

    # Taskbar
    taskbar = render_taskbar(256)
    taskbar.save(ROOT / "taskbarIcon.png", optimize=True)
    print(f"  taskbarIcon.png -> 256x256")

    # Tray
    tray_color = render_tray_color(32)
    tray_color.save(ROOT / "trayIconWin.png", optimize=True)
    print(f"  trayIconWin.png -> 32x32 (color)")

    tray_template = render_tray_template(32)
    tray_template.save(ROOT / "trayTemplate.png", optimize=True)
    print(f"  trayTemplate.png-> 32x32 (alpha-only template)")

    # SVGs
    (ROOT / "icon.svg").write_text(SVG_MASTER, encoding="utf-8")
    (ROOT / "taskbarIcon.svg").write_text(SVG_TASKBAR, encoding="utf-8")
    (ROOT / "trayIconWin.svg").write_text(SVG_TRAY_WIN, encoding="utf-8")
    (ROOT / "trayTemplate.svg").write_text(SVG_TRAY_TEMPLATE, encoding="utf-8")
    print("  icon.svg, taskbarIcon.svg, trayIconWin.svg, trayTemplate.svg -> updated")

    print("\nDone.")


if __name__ == "__main__":
    main()
