from __future__ import annotations

import random
from collections.abc import Callable
from io import BytesIO
from typing import Any

from PIL import ExifTags, Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from image_randomizer.core.registry import normalize_method_name

OperationFn = Callable[[Image.Image, random.Random, dict[str, Any]], Image.Image]
ORIENTATION_TAG = ExifTags.Base.Orientation


def horizontal_mirror(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    return ImageOps.mirror(image)


def vertical_mirror(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    return ImageOps.flip(image)


def invert(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    if image.mode == "RGBA":
        red, green, blue, alpha = image.split()
        rgb = Image.merge("RGB", (red, green, blue))
        inverted = ImageOps.invert(rgb)
        return Image.merge("RGBA", (*inverted.split(), alpha))

    if image.mode != "RGB":
        image = image.convert("RGB")
    return ImageOps.invert(image)


def grayscale(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    return ImageOps.grayscale(image).convert("RGB")


def saturation(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    amount = float(params.get("amount", rng.randint(-25, 25)))
    return ImageEnhance.Color(image).enhance(_percent_factor(amount))


def brightness(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    amount = float(params.get("amount", rng.randint(-10, 10)))
    return ImageEnhance.Brightness(image).enhance(_percent_factor(amount))


def gamma(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    gamma_value = max(0.01, float(params.get("gamma", rng.uniform(0.85, 1.15))))
    if gamma_value == 1.0:
        return image.copy()

    table = [round(255 * ((value / 255) ** gamma_value)) for value in range(256)]
    if image.mode == "L":
        return image.point(table)

    rgb, alpha = _rgb_with_alpha(image)
    corrected = rgb.point(table * 3)
    return _restore_alpha(corrected, alpha)


def hue_shift(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    degrees = float(params.get("degrees", rng.randint(-15, 15)))
    shift = round((degrees % 360) * 255 / 360)
    rgb, alpha = _rgb_with_alpha(image)
    hue, saturation_channel, value = rgb.convert("HSV").split()
    hue = hue.point([(channel + shift) % 256 for channel in range(256)])
    shifted = Image.merge("HSV", (hue, saturation_channel, value)).convert("RGB")
    return _restore_alpha(shifted, alpha)


def crop(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    width, height = image.size
    top_pct = int(params.get("top_pct", rng.randint(5, 15)))
    bottom_pct = int(params.get("bottom_pct", rng.randint(5, 15)))
    left_pct = int(params.get("left_pct", rng.randint(5, 15)))
    right_pct = int(params.get("right_pct", rng.randint(5, 15)))

    left = round(width * left_pct / 100)
    top = round(height * top_pct / 100)
    right = width - round(width * right_pct / 100)
    bottom = height - round(height * bottom_pct / 100)

    if left >= right or top >= bottom:
        return image.copy()
    return image.crop((left, top, right, bottom))


def fixed_resize(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    scale = int(params.get("scale_pct", rng.randint(75, 115)))
    return _resize_percent(image, scale, scale)


def resize(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    scale_x = int(params.get("scale_x_pct", rng.randint(75, 115)))
    scale_y = int(params.get("scale_y_pct", rng.randint(75, 115)))
    return _resize_percent(image, scale_x, scale_y)


def add_noise(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    strength = int(params.get("strength", 8))
    strength = max(0, min(strength, 255))
    mode = image.mode
    working = image.convert("RGBA")
    data = bytearray(working.tobytes())

    for offset in range(0, len(data), 4):
        for channel in range(3):
            value = data[offset + channel] + rng.randint(-strength, strength)
            data[offset + channel] = max(0, min(255, value))

    noisy = Image.frombytes("RGBA", working.size, bytes(data))
    return noisy if mode == "RGBA" else noisy.convert("RGB")


def rotate(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    angle = float(params.get("angle", rng.randint(-15, 15)))
    fill = params.get("fill", (255, 255, 255, 0) if image.mode == "RGBA" else (255, 255, 255))
    return image.rotate(angle, expand=True, fillcolor=tuple(fill))


def normalize_orientation(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    result = ImageOps.exif_transpose(image)
    exif = image.getexif()
    if ORIENTATION_TAG in exif:
        del exif[ORIENTATION_TAG]
    if exif or "exif" in image.info:
        result.info["exif"] = exif.tobytes()
    return result


def border(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    size = int(params.get("size", rng.randint(5, 15)))
    color = params.get("color")
    if color is None:
        color = (rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255))
    return ImageOps.expand(image, border=max(size, 0), fill=tuple(color))


def contrast(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    amount = float(params.get("amount", rng.randint(-30, 30)))
    return ImageEnhance.Contrast(image).enhance(_percent_factor(amount))


def sharpen(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    amount = float(params.get("amount", rng.randint(20, 80)))
    return ImageEnhance.Sharpness(image).enhance(_percent_factor(amount))


def blur(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    blur_type = params.get("type", rng.choice(("gaussian", "simple")))
    if blur_type == "gaussian":
        return image.filter(ImageFilter.GaussianBlur(radius=float(params.get("radius", 1))))
    return image.filter(ImageFilter.BLUR)


def sketch(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    return image.convert("L").filter(ImageFilter.FIND_EDGES).convert("RGB")


def pixelization(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    block_size = int(params.get("block_size", rng.randint(3, 7)))
    block_size = max(1, block_size)
    width, height = image.size
    small_size = (max(1, width // block_size), max(1, height // block_size))
    return image.resize(small_size, Image.Resampling.NEAREST).resize(image.size, Image.Resampling.NEAREST)


def move(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    width, height = image.size
    move_x = int(params.get("x", rng.randint(0, width)))
    move_y = int(params.get("y", rng.randint(0, height)))
    return ImageChops.offset(image, move_x, move_y)


def jpeg_quality(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    quality = max(1, min(100, int(params.get("quality", rng.randint(65, 92)))))
    working = image if image.mode in {"RGB", "L"} else image.convert("RGB")

    buffer = BytesIO()
    working.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)

    compressed = Image.open(buffer)
    compressed.load()
    return compressed.copy()


def watermark(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    text = str(params.get("text", "Image TC"))
    opacity = max(0, min(100, int(params.get("opacity", 35))))
    if not text or opacity == 0:
        return image.copy()

    position = str(params.get("position", "bottom_right"))
    color = _coerce_rgb(params.get("color"), (255, 255, 255))
    alpha = round(255 * opacity / 100)
    width, height = image.size
    margin = round(min(width, height) * max(0.0, float(params.get("margin_pct", 3))) / 100)
    font_size = max(8, round(min(width, height) * max(1.0, float(params.get("size_pct", 5))) / 100))
    stroke_width = max(1, round(font_size * 0.08))

    base = image.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = _load_font(font_size)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_width)
    text_width = round(right - left)
    text_height = round(bottom - top)
    x, y = _watermark_position(position, width, height, text_width, text_height, margin)

    draw.text(
        (x - left, y - top),
        text,
        font=font,
        fill=(*color, alpha),
        stroke_width=stroke_width,
        stroke_fill=(0, 0, 0, round(alpha * 0.55)),
    )
    result = Image.alpha_composite(base, overlay)
    return result if "A" in image.getbands() else result.convert("RGB")


def edit_metadata(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    result = image.copy()
    result.info.update(image.info)
    return result


OPERATION_FUNCTIONS: dict[str, OperationFn] = {
    "hmirror": horizontal_mirror,
    "vmirror": vertical_mirror,
    "invert": invert,
    "grayscale": grayscale,
    "saturation": saturation,
    "brightness": brightness,
    "gamma": gamma,
    "hue_shift": hue_shift,
    "crop": crop,
    "fixresize": fixed_resize,
    "resize": resize,
    "interference": add_noise,
    "rotate": rotate,
    "orientation_normalize": normalize_orientation,
    "border": border,
    "sharp": contrast,
    "sharpen": sharpen,
    "blur": blur,
    "eskiz": sketch,
    "pixelization": pixelization,
    "move": move,
    "jpeg_quality": jpeg_quality,
    "watermark": watermark,
    "metadata": edit_metadata,
}


def apply_operation(image: Image.Image, name: str, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    normalized_name = normalize_method_name(name)
    try:
        operation = OPERATION_FUNCTIONS[normalized_name]
    except KeyError as exc:
        raise ValueError(f"Unknown image operation: {name}") from exc
    result = operation(image, rng, params)
    if normalized_name != "metadata":
        info = dict(image.info)
        info.update(result.info)
        result.info.clear()
        result.info.update(info)
    return result


def _resize_percent(image: Image.Image, scale_x: int, scale_y: int) -> Image.Image:
    width, height = image.size
    new_size = (
        max(1, round(width * scale_x / 100)),
        max(1, round(height * scale_y / 100)),
    )
    return image.resize(new_size, Image.Resampling.BILINEAR)


def _percent_factor(amount: float) -> float:
    return max(0.0, 1.0 + amount / 100.0)


def _rgb_with_alpha(image: Image.Image) -> tuple[Image.Image, Image.Image | None]:
    if "A" not in image.getbands():
        return image.convert("RGB"), None

    rgba = image.convert("RGBA")
    red, green, blue, alpha = rgba.split()
    return Image.merge("RGB", (red, green, blue)), alpha


def _restore_alpha(rgb: Image.Image, alpha: Image.Image | None) -> Image.Image:
    if alpha is None:
        return rgb
    return Image.merge("RGBA", (*rgb.split(), alpha))


def _coerce_rgb(value: object, default: tuple[int, int, int]) -> tuple[int, int, int]:
    if isinstance(value, str) and len(value) == 7 and value.startswith("#"):
        try:
            return (
                int(value[1:3], 16),
                int(value[3:5], 16),
                int(value[5:7], 16),
            )
        except ValueError:
            return default

    if isinstance(value, list | tuple) and len(value) == 3:
        channels: list[int] = []
        for channel in value:
            if isinstance(channel, bool) or not isinstance(channel, int | float):
                return default
            channels.append(max(0, min(255, round(channel))))
        return channels[0], channels[1], channels[2]

    return default


def _load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for font_name in ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(font_name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _watermark_position(
    position: str,
    width: int,
    height: int,
    text_width: int,
    text_height: int,
    margin: int,
) -> tuple[int, int]:
    positions = {
        "top_left": (margin, margin),
        "top_right": (width - text_width - margin, margin),
        "bottom_left": (margin, height - text_height - margin),
        "bottom_right": (width - text_width - margin, height - text_height - margin),
        "center": ((width - text_width) // 2, (height - text_height) // 2),
    }
    x, y = positions.get(position, positions["bottom_right"])
    return max(0, min(width - text_width, x)), max(0, min(height - text_height, y))
