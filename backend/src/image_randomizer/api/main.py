from __future__ import annotations

import json
import random
from dataclasses import asdict
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from image_randomizer.core.analysis import analyze_images
from image_randomizer.core.metadata import read_image_metadata
from image_randomizer.core.models import Recipe
from image_randomizer.core.operations import apply_operation
from image_randomizer.core.pipeline import apply_pipeline, load_image_bytes, parse_recipe_step, save_image_bytes
from image_randomizer.core.recipe import parse_recipe_payload
from image_randomizer.core.registry import get_method_definitions

app = FastAPI(title="Image Randomizer API", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/methods")
def methods() -> dict[str, list[dict[str, object]]]:
    return {"methods": [asdict(method) for method in get_method_definitions()]}


@app.post("/api/metadata/read")
async def metadata_read(file: UploadFile = File(...)) -> dict[str, object]:
    data = await file.read()
    try:
        return read_image_metadata(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/analyze")
async def analyze(
    original: UploadFile = File(...),
    output: UploadFile = File(...),
) -> dict[str, object]:
    original_data = await original.read()
    output_data = await output.read()
    try:
        return analyze_images(original_data, output_data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/randomize")
async def randomize(
    file: UploadFile = File(...),
    recipe: str | None = Form(None),
    operations: str = Form("[]"),
    metadata: str | None = Form(None),
    seed: int | None = Form(None),
    output_format: str = Form("PNG"),
) -> Response:
    metadata_params = parse_metadata_form(metadata)

    if recipe is not None:
        try:
            recipe_payload = json.loads(recipe)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="recipe must be valid JSON") from exc

        try:
            parsed_recipe = parse_recipe_payload(recipe_payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    else:
        try:
            operations_payload = json.loads(operations)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="operations must be valid JSON") from exc

        if not isinstance(operations_payload, list):
            raise HTTPException(status_code=400, detail="operations must be a JSON array")

        try:
            parsed_recipe = Recipe(
                seed=seed,
                output_format=output_format.upper(),
                steps=tuple(parse_recipe_step(operation) for operation in operations_payload),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    data = await file.read()
    try:
        image = load_image_bytes(data)
        result = apply_pipeline(image, parsed_recipe.steps, seed=parsed_recipe.seed)
        if metadata_params:
            result = apply_operation(
                result,
                "metadata",
                random.Random(parsed_recipe.seed),
                metadata_params,
            )
        payload = save_image_bytes(result, parsed_recipe.output_format)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    media_type = f"image/{parsed_recipe.output_format.lower()}"
    return Response(content=payload, media_type=media_type)


def parse_metadata_form(metadata: str | None) -> dict[str, Any]:
    if metadata is None:
        return {}

    try:
        payload = json.loads(metadata)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="metadata must be valid JSON") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="metadata must be a JSON object")

    return payload
