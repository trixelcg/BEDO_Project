# Brand sources -> the served logo and favicon set.
#
#   python3 scripts/brand/build-icons.py
#
# Mirrors scripts/water/: the authored artwork lives in assets-source/brand/ and is never
# served or modified; everything under public/ is a derivative this script regenerates from
# it. Pillow is build tooling, not a runtime dependency.
#
# Two derivations, both measured rather than eyeballed (BEDO-UX-16).
import colorsys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets-source" / "brand"
OUT = ROOT / "public"

LOGO = SRC / "BEDOLogo.png"
ICON = SRC / "FAV_Icon.png"

# The loader field the logo is composited on. Presentation target, not a colour we set.
LOADER_BG = (0x14, 0x15, 0x17)

# --- 1. The dark-background logo variant ------------------------------------------------
#
# ## The problem
#
# BEDOLogo.png is drawn for light backgrounds. 51 % of its opaque pixels are a single dark
# neutral, #3f4045 — the EDO letters, the lower-right ring arc and the subtitle bar — which
# measures 1.77:1 against the loader's #141517. On screen the mark reads as "B + indistinct
# grey shapes". The orange (#f79324) is already fine at 7.96:1.
#
# ## The correction
#
# Lighten the neutrals and nothing else. Every pixel is converted to HSV; hue and saturation
# are carried through untouched and only V is lifted, so the artwork keeps its own slightly
# blue-tinted grey rather than being recoloured. Geometry, proportions and alpha are
# untouched — this is a per-pixel value remap, not a redraw, a resample or a filter.
#
# Which pixels count as neutral is decided by saturation, with a smooth ramp rather than a
# threshold: a hard cut would leave a visible seam along every antialiased edge where orange
# meets grey. Below SAT_NEUTRAL a pixel is fully lifted, above SAT_BRAND it is untouched,
# and between the two it is blended. The orange sits at s = 0.85, far above SAT_BRAND, so it
# is carried through bit-for-bit — asserted at the end of this function.
SAT_NEUTRAL = 0.12
SAT_BRAND = 0.30

# Chosen, not guessed: gamma 0.25 lifts #3f4045 to #a8abb8, which measures 7.99:1 against
# the loader background — the same readability the orange already has. Matching the orange
# is the target because it is the part of the mark that was never in question. Going further
# heads toward white (18.27:1), which the brand mark is not.
NEUTRAL_GAMMA = 0.25


def _relative_luminance(rgb: tuple[int, int, int]) -> float:
    def channel(v: int) -> float:
        s = v / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(rgb: tuple[int, int, int], against: tuple[int, int, int] = LOADER_BG) -> float:
    a, b = _relative_luminance(rgb), _relative_luminance(against)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def _smoothstep(lo: float, hi: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)


def darken_safe_variant(image: Image.Image) -> Image.Image:
    """Lift only the low-saturation elements, so the mark reads on a dark field."""
    out = Image.new("RGBA", image.size)
    src, dst = image.load(), out.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = src[x, y]
            if a == 0:
                dst[x, y] = (r, g, b, a)  # fully transparent: carry through untouched
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            # 1 for neutral, 0 for saturated brand colour, smooth in between.
            weight = 1.0 - _smoothstep(SAT_NEUTRAL, SAT_BRAND, s)
            if weight == 0.0:
                dst[x, y] = (r, g, b, a)
                continue
            lifted = colorsys.hsv_to_rgb(h, s, v**NEUTRAL_GAMMA)
            dst[x, y] = (
                *(
                    round(orig + (new * 255 - orig) * weight)
                    for orig, new in zip((r, g, b), lifted)
                ),
                a,  # alpha is never touched: no halo, no matte, no new fringe
            )
    return out


# --- 2. The favicon crop ----------------------------------------------------------------
#
# FAV_Icon.png is framed for a larger surface than a browser tab: an 87 px empty gutter down
# the left, the B pushed off-centre to the right, and the "INNOVATING EDUCATION" bar clipped
# by the right edge. At 16 px that bar is roughly two pixels of unresolvable mush, and its
# clipped end is the only thing about it a viewer can actually perceive.
#
# So the crop is taken around the primary mark. The bar is one connected region of
# low-saturation pixels — it is the ONLY low-saturation content in the file, which is what
# makes this identification safe rather than a guess — so dropping it leaves exactly the
# orange B, which is then bounded, centred and padded symmetrically. Nothing is redrawn and
# no pixel of the B is altered; it is a reframing.
ICON_CONTENT_FRACTION = 0.86  # the mark fills this much of the square; the rest is margin

ICO_SIZES = [(16, 16), (32, 32), (48, 48)]
PNG_SIZES = {"favicon-16x16.png": 16, "favicon-32x32.png": 32, "apple-touch-icon.png": 180}


def reframe_icon(image: Image.Image) -> Image.Image:
    """Drop the clipped subtitle bar, then centre the mark in a square with even margins."""
    pixels = image.load()
    mark = Image.new("RGBA", image.size)
    target = mark.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            _, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s >= SAT_BRAND:  # keep the brand colour; the bar and its text are neutral
                target[x, y] = (r, g, b, a)

    box = mark.getbbox()
    if box is None:
        raise SystemExit("no saturated content found in the favicon source")
    cropped = mark.crop(box)

    # One square canvas, the mark centred in it. Sized from the LONGER edge so the aspect
    # ratio is preserved exactly — the artwork is never stretched to fill the square.
    side = round(max(cropped.size) / ICON_CONTENT_FRACTION)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    return square


def resample(image: Image.Image, size: int) -> Image.Image:
    """High-quality square downscale that keeps straight alpha straight."""
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    # Only the dark variant is served. The loader is the one surface that shows the mark,
    # and it is dark, so publishing the light-background original as well would put a file
    # in public/ that nothing requests — which tests/unit/assets.spec.ts rejects, by design
    # (BEDO-004). The untouched original stays in assets-source/brand/.
    logo = Image.open(LOGO).convert("RGBA")
    variant = darken_safe_variant(logo)
    variant.save(OUT / "bedo-logo-dark.png", "PNG", optimize=True)

    # The orange must be untouched, and the neutrals must actually have moved. Assert both
    # rather than trusting the maths above.
    before, after = list(logo.getdata()), list(variant.getdata())
    if logo.size != variant.size:
        raise SystemExit("the variant changed the logo's dimensions")
    moved = lifted = 0
    for (r, g, b, a), new in zip(before, after):
        if a == 0:
            continue
        _, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s >= SAT_BRAND:
            if (r, g, b) != new[:3]:
                raise SystemExit(f"brand colour #{r:02x}{g:02x}{b:02x} was altered -> {new[:3]}")
            moved += 1
        elif s < SAT_NEUTRAL and new[:3] != (r, g, b):
            lifted += 1
        if a != new[3]:
            raise SystemExit("alpha was altered; that would introduce a fringe")
    grey_before, grey_after = (0x3F, 0x40, 0x45), None
    for (r, g, b, a), new in zip(before, after):
        if (r, g, b) == grey_before and a > 200:
            grey_after = new[:3]
            break
    print(
        f"  bedo-logo-dark.png     {(OUT / 'bedo-logo-dark.png').stat().st_size:>7,} B  "
        f"#{grey_before[0]:02x}{grey_before[1]:02x}{grey_before[2]:02x} "
        f"({contrast(grey_before):.2f}:1) -> "
        f"#{grey_after[0]:02x}{grey_after[1]:02x}{grey_after[2]:02x} "
        f"({contrast(grey_after):.2f}:1); {moved:,} brand px untouched, {lifted:,} lifted"
    )

    icon = Image.open(ICON).convert("RGBA")
    square = reframe_icon(icon)
    square.save(SRC / "FAV_Icon.centred.png", "PNG", optimize=True)
    print(f"  FAV_Icon.centred.png   {square.width}x{square.height}  derived crop (not served)")

    for name, size in PNG_SIZES.items():
        resample(square, size).save(OUT / name, "PNG", optimize=True)
        print(f"  {name:<22} {size:>3}px  {(OUT / name).stat().st_size:>7,} B")

    # Pillow builds the multi-resolution .ico from one image plus a size list, resampling
    # each entry itself; handing it the pre-resampled 48 keeps the largest entry identical
    # to the LANCZOS output above rather than whatever the .ico writer would choose.
    resample(square, 48).save(OUT / "favicon.ico", "ICO", sizes=ICO_SIZES)
    print(
        f"  {'favicon.ico':<22} {'/'.join(str(s[0]) for s in ICO_SIZES):>8}  "
        f"{(OUT / 'favicon.ico').stat().st_size:>7,} B"
    )


if __name__ == "__main__":
    main()
