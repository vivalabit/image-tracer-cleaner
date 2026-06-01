# Image TC / Image Randomizer Modern

Modern image randomization and metadata-cleaning tool built with a FastAPI backend and a React/Vite frontend.

The project migrates the legacy `image-randomizer` idea to an upload-based API: the browser sends an image, an ordered operation recipe, optional metadata edits, and receives a processed image blob. The backend does not read arbitrary server-side paths from HTTP requests.

## What It Does

- Uploads an image in the browser and previews the processed result.
- Builds an ordered processing pipeline from available backend operations.
- Supports deterministic randomization with an optional seed.
- Exports processed images as `PNG`, `JPEG`, or `WEBP`.
- Reads image metadata through ExifTool.
- Removes GPS/all metadata or writes selected EXIF/XMP fields.
- Compares original and output images with hash, dimensions, file size, metadata, and similarity metrics.

## Stack

- Backend: Python 3.11+, FastAPI, Pillow, Pydantic, Uvicorn.
- Metadata engine: ExifTool.
- Frontend: React 19, TypeScript, Vite.
- Tests and tooling: pytest, ruff, mypy, TypeScript compiler.

## Project Layout

```text
backend/
  src/image_randomizer/
    api/          FastAPI routes
    core/         image operations, recipes, metadata, analysis
  tests/          backend tests
  pyproject.toml  backend package and tooling config

frontend/
  src/            React app, API client, types, styles
  public/         static assets
  vite.config.ts  dev server and /api proxy
```

## Requirements

- Python 3.11 or newer.
- Node.js compatible with Vite 7 (`^20.19.0` or `>=22.12.0`).
- npm.
- ExifTool for metadata read/write features.

On macOS, ExifTool can be installed with:

```bash
brew install exiftool
```

Visual image operations can run without metadata edits, but the metadata endpoints require the `exiftool` binary to be available on `PATH`.

## Quick Start

Run the backend in one terminal:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -e ".[dev]"
python -m uvicorn image_randomizer.api.main:app --reload --host 127.0.0.1 --port 8000
```

Run the frontend in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the app at:

```text
http://127.0.0.1:5173
```

The Vite dev server proxies `/api` requests to `http://127.0.0.1:8000`.

## Backend API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service health check. |
| `GET` | `/api/methods` | Returns operation definitions and parameter metadata. |
| `POST` | `/api/metadata/read` | Reads uploaded image metadata. |
| `POST` | `/api/randomize` | Applies visual operations and optional metadata edits. |
| `POST` | `/api/analyze` | Compares original and output image blobs. |

`POST /api/randomize` accepts multipart form data:

- `file`: uploaded image.
- `operations`: JSON array of active visual operations.
- `metadata`: optional JSON object with metadata edits.
- `seed`: optional integer for reproducible random values.
- `output_format`: `PNG`, `JPEG`, or `WEBP`.

Example `operations` payload:

```json
[
  {
    "name": "resize",
    "params": {
      "scale_x_pct": 101,
      "scale_y_pct": 99
    }
  },
  {
    "name": "interference",
    "params": {
      "strength": 8
    }
  }
]
```

Random parameter ranges can be sent instead of fixed values:

```json
[
  {
    "name": "crop",
    "params": {
      "top_pct": { "mode": "random", "type": "integer", "min": 5, "max": 15 },
      "bottom_pct": { "mode": "random", "type": "integer", "min": 5, "max": 15 }
    }
  }
]
```

Example `metadata` payload:

```json
{
  "strip_gps": true,
  "strip_all": false,
  "creator": "Image TC",
  "software": "Image Randomizer",
  "created_at": "2026-05-28T10:30",
  "taken_at": "2026-05-28T10:30",
  "advanced_edits": [
    { "action": "set", "tag": "IFD0:Make", "value": "OpenAI Camera" },
    { "action": "remove", "group": "IFD0", "tag": "Artist" }
  ]
}
```

## Available Operations

- `hmirror`: horizontal mirror.
- `vmirror`: vertical mirror.
- `invert`: invert RGB colors.
- `grayscale`: convert to grayscale.
- `crop`: crop image edges by percent.
- `fixresize`: resize both axes with one scale.
- `resize`: resize X/Y axes independently.
- `interference`: add RGB noise.
- `rotate`: rotate the image.
- `border`: add a border.
- `sharp`: adjust contrast.
- `blur`: apply simple or Gaussian blur.
- `eskiz`: sketch-like edge filter.
- `pixelization`: pixelate the image.
- `move`: wrap-shift pixels by X/Y offset.
- `metadata`: metadata-only recipe step.

## Testing

Backend:

```bash
cd backend
python -m pytest
```

Frontend type check and production build:

```bash
cd frontend
npm run build
```

## Development Notes

- Keep image input upload-based. Do not reintroduce legacy `path=...` filesystem access in public HTTP endpoints.
- Operation names preserve legacy identifiers where practical, while aliases normalize newer names internally.
- Disabled recipe steps are accepted by the backend and skipped.
- Metadata date values use either `YYYY-MM-DDTHH:MM` or `YYYY:MM:DD HH:MM:SS`.
- ExifTool commands are built as argument arrays, not shell strings.

