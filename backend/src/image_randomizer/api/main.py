from __future__ import annotations

import json
from dataclasses import asdict

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from image_randomizer.core.pipeline import apply_pipeline, load_image_bytes, save_image_bytes
from image_randomizer.core.recipe import parse_recipe_payload
from image_randomizer.core.registry import get_method_definitions

app = FastAPI(title="Image Randomizer API", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/methods")
def methods() -> dict[str, list[dict[str, object]]]:
    return {"methods": [asdict(method) for method in get_method_definitions()]}


@app.post("/api/randomize")
async def randomize(
    file: UploadFile = File(...),
    recipe: str = Form(...),
) -> Response:
    try:
        recipe_payload = json.loads(recipe)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="recipe must be valid JSON") from exc

    try:
        parsed_recipe = parse_recipe_payload(recipe_payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    data = await file.read()
    try:
        image = load_image_bytes(data)
        result = apply_pipeline(image, parsed_recipe.steps, seed=parsed_recipe.seed)
        payload = save_image_bytes(result, parsed_recipe.output_format)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    media_type = f"image/{parsed_recipe.output_format.lower()}"
    return Response(content=payload, media_type=media_type)
