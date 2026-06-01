COMPOSE ?= docker compose

.PHONY: build dev down logs test lint backend-test frontend-build backend-lint frontend-lint

build:
	$(COMPOSE) build

dev:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

test: build backend-test frontend-build

lint: build backend-lint frontend-lint

backend-test:
	$(COMPOSE) run --rm --no-deps backend python -m pytest

frontend-build:
	$(COMPOSE) run --rm --no-deps frontend npm run build

backend-lint:
	$(COMPOSE) run --rm --no-deps backend python -m ruff check .
	$(COMPOSE) run --rm --no-deps backend python -m mypy src

frontend-lint:
	$(COMPOSE) run --rm --no-deps frontend npm run lint
