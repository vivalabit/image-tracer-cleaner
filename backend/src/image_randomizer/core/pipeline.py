from __future__ import annotations

import random
from collections.abc import Iterable, Mapping
from io import BytesIO
from typing import Any

from PIL import Image

from image_randomizer.core.models import Operation, RecipeStep
from image_randomizer.core.operations import apply_operation

SUPPORTED_OUTPUT_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})


def apply_pipeline(
    image: Image.Image,
    operations: Iterable[Operation | RecipeStep | Mapping[str, Any] | str],
    *,
    seed: int | None = None,
) -> Image.Image:
    rng = random.Random(seed)
    result = image.copy()

    for operation in operations:
        parsed = parse_recipe_step(operation)
        if not parsed.enabled:
            continue
        result = apply_operation(result, parsed.name, rng, parsed.params)

    return result


def parse_operation(operation: Operation | Mapping[str, Any] | str) -> Operation:
    parsed = parse_recipe_step(operation)
    return Operation(name=parsed.name, params=parsed.params)


def parse_recipe_step(operation: Operation | RecipeStep | Mapping[str, Any] | str) -> RecipeStep:
    if isinstance(operation, RecipeStep):
        return operation
    if isinstance(operation, Operation):
        return RecipeStep(name=operation.name, params=operation.params)
    if isinstance(operation, str):
        return RecipeStep(name=operation)

    name = operation.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("Operation mapping must contain a non-empty string 'name'")

    enabled = operation.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValueError("Operation 'enabled' must be a boolean")

    params = operation.get("params", {})
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise ValueError("Operation 'params' must be an object")

    return RecipeStep(name=name, enabled=enabled, params=params)


def load_image_bytes(data: bytes) -> Image.Image:
    return Image.open(BytesIO(data))


def save_image_bytes(image: Image.Image, output_format: str = "PNG") -> bytes:
    normalized_format = output_format.upper()
    if normalized_format not in SUPPORTED_OUTPUT_FORMATS:
        raise ValueError("output_format must be one of PNG, JPEG, WEBP")

    if normalized_format == "JPEG" and image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    buffer = BytesIO()
    image.save(buffer, format=normalized_format)
    return buffer.getvalue()
