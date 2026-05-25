from __future__ import annotations

import random
from collections.abc import Iterable, Mapping
from io import BytesIO
from typing import Any

from PIL import Image

from image_randomizer.core.models import Operation
from image_randomizer.core.operations import apply_operation


def apply_pipeline(
    image: Image.Image,
    operations: Iterable[Operation | Mapping[str, Any] | str],
    *,
    seed: int | None = None,
) -> Image.Image:
    rng = random.Random(seed)
    result = image.copy()

    for operation in operations:
        parsed = parse_operation(operation)
        result = apply_operation(result, parsed.name, rng, parsed.params)

    return result


def parse_operation(operation: Operation | Mapping[str, Any] | str) -> Operation:
    if isinstance(operation, Operation):
        return operation
    if isinstance(operation, str):
        return Operation(name=operation)

    name = operation.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("Operation mapping must contain a non-empty string 'name'")

    params = operation.get("params", {})
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise ValueError("Operation 'params' must be an object")

    return Operation(name=name, params=params)


def load_image_bytes(data: bytes) -> Image.Image:
    return Image.open(BytesIO(data))


def save_image_bytes(image: Image.Image, output_format: str = "PNG") -> bytes:
    buffer = BytesIO()
    image.save(buffer, format=output_format.upper())
    return buffer.getvalue()
