from __future__ import annotations

import json
import unittest
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from image_randomizer.api.main import app


class ApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health(self) -> None:
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_methods_include_metadata(self) -> None:
        response = self.client.get("/api/methods")

        self.assertEqual(response.status_code, 200)
        methods = response.json()["methods"]
        by_name = {method["name"]: method for method in methods}

        self.assertEqual(by_name["hmirror"]["legacy_name"], "hmirror")
        self.assertTrue(by_name["hmirror"]["reversible"])
        self.assertFalse(by_name["hmirror"]["has_settings"])

        crop = by_name["crop"]
        self.assertEqual(crop["legacy_name"], "crop")
        self.assertEqual(crop["parameters"][0]["name"], "top_pct")
        self.assertEqual(crop["parameters"][0]["random_default"], {"min": 5, "max": 15})

    def test_randomize_uploads_real_png(self) -> None:
        image = Image.new("RGB", (3, 2), "black")
        image.putpixel((0, 0), (255, 0, 0))

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.png", _save_png(image), "image/png")},
            data={
                "recipe": json.dumps(
                    {
                        "seed": 42,
                        "output_format": "PNG",
                        "steps": [{"name": "hmirror", "enabled": True, "params": {}}],
                    }
                ),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")

        result = Image.open(BytesIO(response.content))
        self.assertEqual(result.size, (3, 2))
        self.assertEqual(result.getpixel((2, 0)), (255, 0, 0))

    def test_randomize_accepts_operations_payload(self) -> None:
        image = Image.new("RGB", (3, 2), "black")
        image.putpixel((0, 0), (255, 0, 0))

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.png", _save_png(image), "image/png")},
            data={
                "operations": json.dumps([{"name": "hmirror", "params": {}}]),
                "seed": "42",
                "output_format": "PNG",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")

        result = Image.open(BytesIO(response.content))
        self.assertEqual(result.size, (3, 2))
        self.assertEqual(result.getpixel((2, 0)), (255, 0, 0))

    def test_randomize_skips_disabled_recipe_steps(self) -> None:
        image = Image.new("RGB", (3, 2), "black")
        image.putpixel((0, 0), (255, 0, 0))

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.png", _save_png(image), "image/png")},
            data={
                "recipe": json.dumps(
                    {
                        "seed": None,
                        "output_format": "PNG",
                        "steps": [{"name": "hmirror", "enabled": False, "params": {}}],
                    }
                ),
            },
        )

        self.assertEqual(response.status_code, 200)

        result = Image.open(BytesIO(response.content))
        self.assertEqual(result.getpixel((0, 0)), (255, 0, 0))

    def test_randomize_requires_recipe_object(self) -> None:
        image = Image.new("RGB", (3, 2), "black")

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.png", _save_png(image), "image/png")},
            data={"recipe": json.dumps([{"name": "hmirror"}])},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "recipe must be a JSON object")


def _save_png(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
