from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from image_randomizer.core.models import Recipe
from image_randomizer.core.pipeline import SUPPORTED_OUTPUT_FORMATS, parse_recipe_step


def parse_recipe_payload(payload: object) -> Recipe:
    if not isinstance(payload, Mapping):
        raise ValueError("recipe must be a JSON object")

    seed = payload.get("seed")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int)):
        raise ValueError("recipe.seed must be an integer or null")

    output_format = payload.get("output_format", "PNG")
    if not isinstance(output_format, str):
        raise ValueError("recipe.output_format must be a string")

    normalized_output_format = output_format.upper()
    if normalized_output_format not in SUPPORTED_OUTPUT_FORMATS:
        raise ValueError("recipe.output_format must be one of PNG, JPEG, WEBP")

    steps = payload.get("steps")
    if not isinstance(steps, list):
        raise ValueError("recipe.steps must be a JSON array")

    return Recipe(
        seed=seed,
        output_format=normalized_output_format,
        steps=tuple(parse_recipe_step(step) for step in steps),
    )

    
    

