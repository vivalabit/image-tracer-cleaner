# Image Randomizer Backend

## API Contract

The canonical API is upload-based:

- `GET /api/health` returns service status.
- `GET /api/methods` returns available operations, their legacy names, reversibility, and parameter metadata.
- `POST /api/randomize` accepts multipart form data with `file` plus a JSON `recipe` field.

Legacy PHP filesystem semantics are not exposed as HTTP endpoints in the Python backend. In particular,
`?req=randomizeImage&path=...` and server-side reads from an `images/` directory are intentionally not
part of the new public contract.

The shared recipe contract is:

```json
{
  "file": "multipart file field",
  "seed": 42,
  "output_format": "PNG",
  "steps": [
    {
      "name": "resize",
      "enabled": true,
      "params": {
        "scale_x_pct": 101,
        "scale_y_pct": 99
      }
    }
  ]
}
```

Because HTTP upload uses multipart encoding, the browser sends `file` as the multipart file part and
serializes the remaining recipe fields into the JSON `recipe` form field. Disabled steps are accepted
and skipped by the backend. `output_format` must be `PNG`, `JPEG`, or `WEBP`.

For migration, `image_randomizer.core.legacy` parses legacy query operation flags while preserving order:

```text
hmirror=y&crop=y&sharp=y
```

becomes:

```json
[
  {"name": "hmirror", "enabled": true, "params": {}},
  {"name": "crop", "enabled": true, "params": {}},
  {"name": "sharp", "enabled": true, "params": {}}
]
```

This lets the future UI or compatibility layer translate old method selections into the new
`POST /api/randomize` recipe without reintroducing path-based file access.

## Run

```bash
python -m pip install -e ".[dev]"
python -m pytest
python -m uvicorn image_randomizer.api.main:app --reload --host 127.0.0.1 --port 8000
```
