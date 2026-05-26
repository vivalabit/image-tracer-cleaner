from __future__ import annotations

import json
import unittest
from hashlib import sha256
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import ExifTags, Image, ImageCms, PngImagePlugin

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

        metadata = by_name["metadata"]
        self.assertEqual(metadata["parameters"][0]["name"], "strip_gps")
        self.assertEqual(metadata["parameters"][0]["type"], "boolean")
        self.assertEqual(metadata["parameters"][1]["name"], "strip_all")
        self.assertEqual(metadata["parameters"][2]["name"], "creator")
        self.assertEqual(metadata["parameters"][2]["type"], "string")
        self.assertEqual(metadata["parameters"][3]["default"], "Image Randomizer")

    def test_metadata_read_returns_read_only_metadata(self) -> None:
        image = Image.new("RGB", (4, 3), "black")
        payload = _save_png_with_metadata(image)

        response = self.client.post(
            "/api/metadata/read",
            files={"file": ("input.png", payload, "image/png")},
        )

        self.assertEqual(response.status_code, 200)
        metadata = response.json()

        self.assertEqual(metadata["format"], "PNG")
        self.assertEqual(metadata["dimensions"], {"width": 4, "height": 3})
        self.assertEqual(metadata["exif"], {})
        self.assertEqual(metadata["iptc"], {})
        self.assertIn("XML:com.adobe.xmp", metadata["xmp"])
        self.assertTrue(metadata["gps_presence"])
        self.assertTrue(metadata["color_profile"]["present"])
        self.assertGreater(metadata["color_profile"]["bytes"], 0)
        self.assertEqual(len(metadata["color_profile"]["sha256"]), 64)
        self.assertEqual(metadata["file_hash"], sha256(payload).hexdigest())

    def test_metadata_read_returns_exif(self) -> None:
        image = Image.new("RGB", (4, 3), "black")
        payload = _save_jpeg_with_exif(image)

        response = self.client.post(
            "/api/metadata/read",
            files={"file": ("input.jpg", payload, "image/jpeg")},
        )

        self.assertEqual(response.status_code, 200)
        metadata = response.json()

        self.assertEqual(metadata["format"], "JPEG")
        self.assertEqual(metadata["dimensions"], {"width": 4, "height": 3})
        self.assertEqual(metadata["exif"]["Artist"], "Image Randomizer Test")
        self.assertFalse(metadata["gps_presence"])

    def test_analyze_returns_hash_delta_metadata_and_similarity(self) -> None:
        image = Image.new("RGB", (4, 3), "black")
        original_payload = _save_png_with_metadata(image)
        output_payload = _save_png(image)

        response = self.client.post(
            "/api/analyze",
            files={
                "original": ("original.png", original_payload, "image/png"),
                "output": ("output.png", output_payload, "image/png"),
            },
        )

        self.assertEqual(response.status_code, 200)
        analysis = response.json()

        self.assertEqual(analysis["original_hash"], sha256(original_payload).hexdigest())
        self.assertEqual(analysis["output_hash"], sha256(output_payload).hexdigest())
        self.assertEqual(analysis["dimensions_delta"]["width_delta"], 0)
        self.assertEqual(analysis["dimensions_delta"]["height_delta"], 0)
        self.assertEqual(analysis["file_size_delta"]["original_bytes"], len(original_payload))
        self.assertEqual(analysis["file_size_delta"]["output_bytes"], len(output_payload))
        self.assertEqual(analysis["file_size_delta"]["delta_bytes"], len(output_payload) - len(original_payload))
        self.assertTrue(analysis["metadata_changes"]["changed"])
        self.assertIn("xmp.XML:com.adobe.xmp", analysis["metadata_changes"]["removed"])
        self.assertIn("gps_presence", analysis["metadata_changes"]["modified"])
        self.assertEqual(analysis["visual_similarity_score"], 100.0)

    def test_analyze_detects_visual_difference(self) -> None:
        original = Image.new("RGB", (4, 3), "black")
        output = Image.new("RGB", (4, 3), "white")

        response = self.client.post(
            "/api/analyze",
            files={
                "original": ("original.png", _save_png(original), "image/png"),
                "output": ("output.png", _save_png(output), "image/png"),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertLess(response.json()["visual_similarity_score"], 1.0)

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

    def test_randomize_metadata_step_edits_metadata(self) -> None:
        image = Image.new("RGB", (3, 2), "black")

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.jpg", _save_jpeg_with_exif(image), "image/jpeg")},
            data={
                "operations": json.dumps(
                    [
                        {
                            "name": "metadata",
                            "params": {
                                "strip_gps": True,
                                "strip_all": False,
                                "creator": "",
                                "software": "Image Randomizer",
                            },
                        }
                    ]
                ),
                "output_format": "JPEG",
            },
        )

        self.assertEqual(response.status_code, 200)

        metadata_response = self.client.post(
            "/api/metadata/read",
            files={"file": ("output.jpg", response.content, "image/jpeg")},
        )
        metadata = metadata_response.json()

        self.assertNotIn("Artist", metadata["exif"])
        self.assertEqual(metadata["exif"]["Software"], "Image Randomizer")

    def test_randomize_metadata_step_strips_gps_xmp(self) -> None:
        image = Image.new("RGB", (3, 2), "black")

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.png", _save_png_with_metadata(image), "image/png")},
            data={
                "operations": json.dumps(
                    [
                        {
                            "name": "metadata",
                            "params": {
                                "strip_gps": True,
                                "strip_all": False,
                                "creator": "",
                                "software": "Image Randomizer",
                            },
                        }
                    ]
                ),
                "output_format": "PNG",
            },
        )

        self.assertEqual(response.status_code, 200)

        metadata_response = self.client.post(
            "/api/metadata/read",
            files={"file": ("output.png", response.content, "image/png")},
        )
        metadata = metadata_response.json()

        self.assertFalse(metadata["gps_presence"])
        self.assertEqual(metadata["xmp"], {})
        self.assertEqual(metadata["exif"]["Software"], "Image Randomizer")

    def test_randomize_metadata_step_strips_all_metadata(self) -> None:
        image = Image.new("RGB", (3, 2), "black")

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.png", _save_png_with_metadata(image), "image/png")},
            data={
                "operations": json.dumps(
                    [
                        {
                            "name": "metadata",
                            "params": {
                                "strip_all": True,
                                "creator": "",
                                "software": "",
                            },
                        }
                    ]
                ),
                "output_format": "PNG",
            },
        )

        self.assertEqual(response.status_code, 200)

        metadata_response = self.client.post(
            "/api/metadata/read",
            files={"file": ("output.png", response.content, "image/png")},
        )
        metadata = metadata_response.json()

        self.assertEqual(metadata["exif"], {})
        self.assertEqual(metadata["xmp"], {})
        self.assertIsNone(metadata["color_profile"])

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


def _save_png_with_metadata(image: Image.Image) -> bytes:
    xmp = (
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description exif:GPSLatitude="46,12N" '
        'xmlns:exif="http://ns.adobe.com/exif/1.0/" />'
        "</rdf:RDF>"
        "</x:xmpmeta>"
    )
    png_info = PngImagePlugin.PngInfo()
    png_info.add_text("XML:com.adobe.xmp", xmp)
    icc_profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()

    buffer = BytesIO()
    image.save(buffer, format="PNG", pnginfo=png_info, icc_profile=icc_profile)
    return buffer.getvalue()


def _save_jpeg_with_exif(image: Image.Image) -> bytes:
    exif = Image.Exif()
    exif[ExifTags.Base.Artist] = "Image Randomizer Test"

    buffer = BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()
