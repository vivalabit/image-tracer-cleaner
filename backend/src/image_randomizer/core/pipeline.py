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
        result = apply_operation(result, parsed.name, rng, resolve_random_params(parsed.params, rng))

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


def resolve_random_params(params: Mapping[str, Any], rng: random.Random) -> dict[str, Any]:
    resolved: dict[str, Any] = {}
    for name, value in params.items():
        if is_random_param_spec(value):
            resolved[name] = generate_random_param_value(value, rng)
        else:
            resolved[name] = value
    return resolved


def is_random_param_spec(value: object) -> bool:
    return isinstance(value, Mapping) and value.get("mode") == "random"


def generate_random_param_value(spec: Mapping[str, Any], rng: random.Random) -> Any:
    param_type = spec.get("type")

    if param_type == "integer":
        minimum, maximum = get_numeric_bounds(spec)
        return rng.randint(round(minimum), round(maximum))

    if param_type == "number":
        minimum, maximum = get_numeric_bounds(spec)
        return rng.uniform(minimum, maximum)

    if param_type == "rgb_color":
        minimum = parse_color_bound(spec.get("min"))
        maximum = parse_color_bound(spec.get("max"))
        return tuple(rng.randint(min(a, b), max(a, b)) for a, b in zip(minimum, maximum, strict=True))

    if param_type == "enum":
        choices = spec.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("Random enum parameter must contain non-empty 'choices'")
        return rng.choice(choices)

    raise ValueError("Random parameter must contain a supported 'type'")


def get_numeric_bounds(spec: Mapping[str, Any]) -> tuple[float, float]:
    minimum = coerce_number(spec.get("min"), "min")
    maximum = coerce_number(spec.get("max"), "max")
    return (minimum, maximum) if minimum <= maximum else (maximum, minimum)


def coerce_number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"Random numeric parameter '{name}' must be a number")
    return float(value)


def parse_color_bound(value: object) -> tuple[int, int, int]:
    if isinstance(value, str) and len(value) == 7 and value.startswith("#"):
        try:
            return (
                int(value[1:3], 16),
                int(value[3:5], 16),
                int(value[5:7], 16),
            )
        except ValueError as exc:
            raise ValueError("Random color bounds must be #RRGGBB or RGB arrays") from exc

    if isinstance(value, list) and len(value) == 3:
        channels: list[int] = []
        for channel in value:
            if isinstance(channel, bool) or not isinstance(channel, int):
                raise ValueError("Random color channels must be integers")
            channels.append(max(0, min(255, channel)))
        return tuple(channels)

    raise ValueError("Random color bounds must be #RRGGBB or RGB arrays")


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
