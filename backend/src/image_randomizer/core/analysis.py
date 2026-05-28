from __future__ import annotations

import hashlib
import math
from collections.abc import Mapping, Sequence
from io import BytesIO

from PIL import Image, ImageChops, UnidentifiedImageError

from image_randomizer.core.metadata import read_image_metadata


def analyze_images(
    original_data: bytes,
    output_data: bytes,
    *,
    original_suffix: str = ".bin",
    output_suffix: str = ".bin",
) -> dict[str, object]:
    original_image = open_image(original_data)
    output_image = open_image(output_data)
    original_metadata = read_image_metadata(original_data, suffix=original_suffix)
    output_metadata = read_image_metadata(output_data, suffix=output_suffix)

    return {
        "original_hash": hashlib.sha256(original_data).hexdigest(),
        "output_hash": hashlib.sha256(output_data).hexdigest(),
        "dimensions_delta": build_dimensions_delta(original_image, output_image),
        "file_size_delta": build_file_size_delta(len(original_data), len(output_data)),
        "metadata_changes": compare_metadata(original_metadata, output_metadata),
        "visual_similarity_score": calculate_visual_similarity(original_image, output_image),
    }


def open_image(data: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(data))
        image.load()
        return image
    except UnidentifiedImageError as exc:
        raise ValueError("files must be valid images") from exc


def build_dimensions_delta(original: Image.Image, output: Image.Image) -> dict[str, object]:
    original_dimensions = {"width": original.width, "height": original.height}
    output_dimensions = {"width": output.width, "height": output.height}

    return {
        "original": original_dimensions,
        "output": output_dimensions,
        "width_delta": output.width - original.width,
        "height_delta": output.height - original.height,
    }


def build_file_size_delta(original_size: int, output_size: int) -> dict[str, object]:
    delta = output_size - original_size
    percent = None if original_size == 0 else round(delta / original_size * 100, 2)

    return {
        "original_bytes": original_size,
        "output_bytes": output_size,
        "delta_bytes": delta,
        "delta_percent": percent,
    }


def compare_metadata(
    original: Sequence[Mapping[str, object]],
    output: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    original_flat = flatten_metadata(original)
    output_flat = flatten_metadata(output)
    original_keys = set(original_flat)
    output_keys = set(output_flat)

    added = sorted(output_keys - original_keys)
    removed = sorted(original_keys - output_keys)
    modified = sorted(key for key in original_keys & output_keys if original_flat[key] != output_flat[key])

    return {
        "changed": bool(added or removed or modified),
        "added": added,
        "removed": removed,
        "modified": modified,
    }


def flatten_metadata(metadata: Sequence[Mapping[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for item in metadata:
        group = str(item.get("group", "Unknown"))
        tag = str(item.get("tag", "Unknown"))
        flatten_value(f"{group}.{tag}", item.get("value"), result)
    return result


def flatten_value(path: str, value: object, result: dict[str, object]) -> None:
    if value is None:
        return

    if isinstance(value, Mapping):
        for key, item in value.items():
            flatten_value(f"{path}.{key}", item, result)
        return

    if isinstance(value, list):
        result[path] = tuple(value)
        return

    result[path] = value


def calculate_visual_similarity(original: Image.Image, output: Image.Image) -> float:
    original_rgb = original.convert("RGB")
    output_rgb = output.convert("RGB")
    if original_rgb.size != output_rgb.size:
        output_rgb = output_rgb.resize(original_rgb.size, Image.Resampling.BILINEAR)

    diff = ImageChops.difference(original_rgb, output_rgb)
    histogram = diff.histogram()
    square_sum = sum(count * ((index % 256) ** 2) for index, count in enumerate(histogram))
    total_values = original_rgb.width * original_rgb.height * 3
    if total_values == 0:
        return 100.0

    rms = math.sqrt(square_sum / total_values)
    score = max(0.0, 100.0 * (1.0 - rms / 255.0))
    return round(score, 2)
