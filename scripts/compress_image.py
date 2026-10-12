#!/usr/bin/env python3
"""Compress an image to be used as a website logo, keeping it under a target size.

Usage:
    python compress_image.py INPUT [OUTPUT] [--max-size 512] [--max-kb 100] [--format webp]

- Resizes so the longest side <= --max-size (keeps aspect ratio).
- Preserves transparency (RGBA) for webp/png.
- Binary-searches the quality setting until the file is <= --max-kb.
- Falls back to the smallest result found if the target can't be met, and warns.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image


def shrink_to_max(image: Image.Image, max_size: int) -> Image.Image:
    """Resize so the longest side is at most max_size, keeping aspect ratio."""
    w, h = image.size
    longest = max(w, h)
    if longest <= max_size:
        return image
    scale = max_size / longest
    new_size = (max(1, round(w * scale)), max(1, round(h * scale)))
    # LANCZOS keeps logos crisp when downscaling.
    return image.resize(new_size, Image.LANCZOS)


def save_bytes(image: Image.Image, path: Path, fmt: str, quality: int) -> int:
    image.save(path, format=fmt, quality=quality, method=6)
    return path.stat().st_size


def compress(image: Image.Image, out_path: Path, fmt: str, max_kb: int) -> int:
    target = max_kb * 1024
    # WebP quality range is 0-100; binary search for the largest quality
    # that still fits under the target size.
    lo, hi = 0, 100
    best_quality, best_size = 100, save_bytes(image, out_path, fmt, 100)
    if best_size <= target:
        return best_size

    while lo <= hi:
        mid = (lo + hi) // 2
        size = save_bytes(image, out_path, fmt, mid)
        if size <= target:
            best_quality, best_size = mid, size
            lo = mid + 1  # try higher quality
        else:
            hi = mid - 1

    # Write the best result we found.
    save_bytes(image, out_path, fmt, best_quality)
    return best_size


def main() -> int:
    parser = argparse.ArgumentParser(description="Compress an image for use as a website logo.")
    parser.add_argument("input", help="Path to the source image.")
    parser.add_argument("output", nargs="?", help="Output path (default: input stem + '-logo' + ext).")
    parser.add_argument("--max-size", type=int, default=512, help="Longest side in px (default 512).")
    parser.add_argument("--max-kb", type=int, default=100, help="Target max size in KB (default 100).")
    parser.add_argument("--format", choices=["webp", "png"], default="webp",
                        help="Output format (default webp; both keep transparency).")
    args = parser.parse_args()

    src = Path(args.input)
    if not src.exists():
        print(f"error: input not found: {src}", file=sys.stderr)
        return 1

    with Image.open(src) as img:
        img = img.convert("RGBA")
        img = shrink_to_max(img, args.max_size)
        print(f"resized to {img.size}")

        out_path = Path(args.output) if args.output else src.with_name(f"{src.stem}-logo.{args.format}")
        size = compress(img, out_path, args.format.upper(), args.max_kb)
        kb = size / 1024
        if kb <= args.max_kb:
            print(f"ok: {out_path} -> {kb:.1f} KB (<= {args.max_kb} KB)")
        else:
            print(f"warn: could not reach {args.max_kb} KB; smallest was {kb:.1f} KB at {out_path}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
