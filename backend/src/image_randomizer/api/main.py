from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from image_randomizer.core.analysis import analyze_images
from image_randomizer.core.metadata import apply_metadata_edits, read_image_metadata
from image_randomizer.core.models import Recipe, RecipeStep
from image_randomizer.core.pipeline import apply_pipeline, load_image_bytes, parse_recipe_step, save_image_bytes
from image_randomizer.core.recipe import parse_recipe_payload
from image_randomizer.core.registry import get_method_definitions, normalize_method_name

app = FastAPI(title="Image Randomizer API", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/methods")
def methods() -> dict[str, list[dict[str, object]]]:
    return {"methods": [asdict(method) for method in get_method_definitions()]}


@app.post("/api/metadata/read")
async def metadata_read(file: UploadFile = File(...)) -> list[dict[str, object]]:
    data = await file.read()
    try:
        return read_image_metadata(data, suffix=get_upload_suffix(file))
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
        return analyze_images(
            original_data,
            output_data,
            original_suffix=get_upload_suffix(original),
            output_suffix=get_upload_suffix(output),
        )
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
        visual_steps, metadata_edits = split_metadata_steps(parsed_recipe.steps)
        if metadata_params:
            metadata_edits.append(metadata_params)
        result = apply_pipeline(image, visual_steps, seed=parsed_recipe.seed)
        payload = save_image_bytes(result, parsed_recipe.output_format)
        if metadata_edits:
            payload = apply_metadata_edits(
                payload,
                metadata_edits,
                suffix=get_output_suffix(parsed_recipe.output_format),
            )
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


def get_upload_suffix(file: UploadFile) -> str:
    filename = file.filename or ""
    return Path(filename).suffix or ".bin"


def get_output_suffix(output_format: str) -> str:
    return f".{output_format.lower().replace('jpeg', 'jpg')}"


def split_metadata_steps(steps: tuple[RecipeStep, ...]) -> tuple[list[RecipeStep], list[dict[str, Any]]]:
    visual_steps: list[RecipeStep] = []
    metadata_edits: list[dict[str, Any]] = []
    for step in steps:
        if normalize_method_name(step.name) != "metadata":
            visual_steps.append(step)
            continue

        if step.enabled:
            metadata_edits.append(step.params)

    return visual_steps, metadata_edits
