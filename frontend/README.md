# Image Randomizer Frontend

React + TypeScript + Vite MVP for the Python backend contract.

## Scope

- Loads operations from `GET /api/methods`.
- Uploads one image from the browser.
- Reads uploaded image metadata through `POST /api/metadata/read`.
- Lets the user build ordered pipeline steps with `name`, `enabled`, and `params`.
- Supports manual exact parameter values and backend-seeded random min/max parameter ranges.
- Builds boolean and string metadata controls from the backend method registry.
- Sends active steps as `operations` through `POST /api/randomize`.
- Analyzes the generated output with `POST /api/analyze` for visual, hash, metadata, and size metrics.
- Supports an optional seed for reproducible random defaults.
- Does not include bulk processing or legacy `path=...` flows.

## Run

Start the backend on `127.0.0.1:8000`, then:

```bash
npm install
npm run dev
```

The Vite dev server proxies `/api` to the backend.
