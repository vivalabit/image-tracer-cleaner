# Image Randomizer Backend

## API Contract

The canonical API is upload-based:

- `GET /api/health` returns service status.
- `GET /api/methods` returns available operations, their legacy names, reversibility, and parameter metadata.
- `POST /api/randomize` accepts an uploaded image, an ordered JSON operation list, an optional seed, and an output format.

Legacy PHP filesystem semantics are not exposed as HTTP endpoints in the Python backend. In particular,
`?req=randomizeImage&path=...` and server-side reads from an `images/` directory are intentionally not
part of the new public contract.

For migration, `image_randomizer.core.legacy` parses legacy query operation flags while preserving order:

```text
hmirror=y&crop=y&sharp=y
```

becomes:

```json
[
  {"name": "hmirror", "params": {}},
  {"name": "crop", "params": {}},
  {"name": "sharp", "params": {}}
]
```

This lets the future UI or compatibility layer translate old method selections into the new
`POST /api/randomize` payload without reintroducing path-based file access.

## Run

```bash
python -m pip install -e ".[dev]"
python -m pytest
python -m uvicorn image_randomizer.api.main:app --reload --host 127.0.0.1 --port 8000
```
