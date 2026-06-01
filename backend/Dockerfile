FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libimage-exiftool-perl \
  && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src ./src
COPY tests ./tests

RUN python -m pip install --upgrade pip \
  && python -m pip install -e ".[dev]"

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "image_randomizer.api.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"]
