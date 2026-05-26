from __future__ import annotations

import random
from collections.abc import Callable
from typing import Any

from PIL import ExifTags, Image, ImageChops, ImageEnhance, ImageFilter, ImageOps

from image_randomizer.core.registry import normalize_method_name

OperationFn = Callable[[Image.Image, random.Random, dict[str, Any]], Image.Image]


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


def border(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    size = int(params.get("size", rng.randint(5, 15)))
    color = params.get("color")
    if color is None:
        color = (rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255))
    return ImageOps.expand(image, border=max(size, 0), fill=tuple(color))


def contrast(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    amount = float(params.get("amount", rng.randint(-30, 30)))
    factor = max(0.0, 1.0 + amount / 100.0)
    return ImageEnhance.Contrast(image).enhance(factor)


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


def edit_metadata(image: Image.Image, rng: random.Random, params: dict[str, Any]) -> Image.Image:
    result = image.copy()
    result.info.update(image.info)

    strip_all = coerce_metadata_bool(params.get("strip_all"), default=False)
    strip_gps = coerce_metadata_bool(params.get("strip_gps"), default=True)
    if strip_all:
        result.info.clear()
    elif strip_gps:
        strip_gps_info(result)

    if "creator" in params:
        set_metadata_text(result, ExifTags.Base.Artist, "Creator", str(params["creator"]))
    if "software" in params:
        set_metadata_text(result, ExifTags.Base.Software, "Software", str(params["software"]))

    return result


OPERATION_FUNCTIONS: dict[str, OperationFn] = {
    "hmirror": horizontal_mirror,
    "vmirror": vertical_mirror,
    "invert": invert,
    "grayscale": grayscale,
    "crop": crop,
    "fixresize": fixed_resize,
    "resize": resize,
    "interference": add_noise,
    "rotate": rotate,
    "border": border,
    "sharp": contrast,
    "blur": blur,
    "eskiz": sketch,
    "pixelization": pixelization,
    "move": move,
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
        result.info.update(image.info)
    return result


def _resize_percent(image: Image.Image, scale_x: int, scale_y: int) -> Image.Image:
    width, height = image.size
    new_size = (
        max(1, round(width * scale_x / 100)),
        max(1, round(height * scale_y / 100)),
    )
    return image.resize(new_size, Image.Resampling.BILINEAR)


def strip_gps_info(image: Image.Image) -> None:
    exif = image.getexif()
    if exif and ExifTags.IFD.GPSInfo in exif:
        del exif[ExifTags.IFD.GPSInfo]
        image.info["exif"] = exif.tobytes()

    for key in ("XML:com.adobe.xmp", "xmp"):
        value = image.info.get(key)
        if value is not None and "GPS" in str(value):
            image.info.pop(key, None)


def coerce_metadata_bool(value: object, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return bool(value)


def set_metadata_text(image: Image.Image, exif_tag: int, png_key: str, value: str) -> None:
    exif = image.getexif()
    if value:
        exif[exif_tag] = value
        image.info[png_key] = value
    else:
        if exif_tag in exif:
            del exif[exif_tag]
        image.info.pop(png_key, None)

    if exif:
        image.info["exif"] = exif.tobytes()
    else:
        image.info.pop("exif", None)
