# Image Randomizer Modern

Modern Python/React migration of https://github.com/AlexusBlack/image-randomizer.

This folder is isolated from the surrounding workspace because the current checkout is not the legacy repository.

## Layout

- `backend/` - Python image processing core and FastAPI API.
- `frontend/` - reserved for React/Vite frontend.

## Backend MVP

The first backend slice focuses on deterministic, testable image operations:

- legacy operation identifiers are preserved;
- operations are applied in user-defined order;
- random operations accept a seed for reproducible tests and future job replay.

Run core tests from this directory:

```bash
python3 -m unittest discover backend/tests
```

Install backend dependencies later from `backend/`:

```bash
python3 -m pip install -e ".[dev]"
```

Run the API after installing dependencies:

```bash
uvicorn image_randomizer.api.main:app --app-dir backend/src --reload
```
