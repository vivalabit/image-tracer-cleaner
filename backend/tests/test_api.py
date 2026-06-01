from __future__ import annotations

import json
import subprocess
import unittest
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import ExifTags, Image, ImageCms, PngImagePlugin

from image_randomizer.api.main import app


class ApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.exiftool_run = patch(
            "image_randomizer.core.exiftool_engine.subprocess.run",
            side_effect=_fake_exiftool_run,
        )
        self.exiftool_run.start()

    def tearDown(self) -> None:
        self.exiftool_run.stop()

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

        self.assertEqual(by_name["brightness"]["parameters"][0]["random_default"], {"min": -10, "max": 10})
        self.assertEqual(by_name["gamma"]["parameters"][0]["value_range"], {"min": 0.1, "max": 5})
        self.assertEqual(by_name["jpeg_quality"]["parameters"][0]["name"], "quality")
        self.assertFalse(by_name["orientation_normalize"]["has_settings"])
        self.assertEqual(by_name["watermark"]["parameters"][0]["default"], "Image TC")

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

        self.assertEqual(_metadata_value(metadata, "File", "FileType"), "PNG")
        self.assertEqual(_metadata_value(metadata, "File", "ImageWidth"), 4)
        self.assertEqual(_metadata_value(metadata, "File", "ImageHeight"), 3)
        self.assertIn("XMP.XML:com.adobe.xmp", _metadata_keys(metadata))
        self.assertTrue(_metadata_has_gps(metadata))
        profile_bytes = _metadata_value(metadata, "ICC_Profile", "ProfileBytes")
        self.assertIsInstance(profile_bytes, int)
        assert isinstance(profile_bytes, int)
        self.assertGreater(profile_bytes, 0)
        self.assertFalse(_metadata_item(metadata, "File", "FileType")["writable"])
        self.assertTrue(_metadata_item(metadata, "XMP", "XML:com.adobe.xmp")["writable"])

    def test_metadata_read_returns_exif(self) -> None:
        image = Image.new("RGB", (4, 3), "black")
        payload = _save_jpeg_with_exif(image)

        response = self.client.post(
            "/api/metadata/read",
            files={"file": ("input.jpg", payload, "image/jpeg")},
        )

        self.assertEqual(response.status_code, 200)
        metadata = response.json()

        self.assertEqual(_metadata_value(metadata, "File", "FileType"), "JPEG")
        self.assertEqual(_metadata_value(metadata, "File", "ImageWidth"), 4)
        self.assertEqual(_metadata_value(metadata, "File", "ImageHeight"), 3)
        self.assertEqual(_metadata_value(metadata, "IFD0", "Artist"), "Image Randomizer Test")
        self.assertFalse(_metadata_has_gps(metadata))

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
        self.assertIn("XMP.XML:com.adobe.xmp", analysis["metadata_changes"]["removed"])
        self.assertIn("ICC_Profile.ProfileBytes", analysis["metadata_changes"]["removed"])
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

    def test_randomize_accepts_metadata_payload_outside_operations(self) -> None:
        image = Image.new("RGB", (3, 2), "black")
        image.putpixel((0, 0), (255, 0, 0))

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.png", _save_png_with_metadata(image), "image/png")},
            data={
                "operations": json.dumps([{"name": "hmirror", "params": {}}]),
                "metadata": json.dumps({"strip_all": True}),
                "seed": "42",
                "output_format": "PNG",
            },
        )

        self.assertEqual(response.status_code, 200)

        result = Image.open(BytesIO(response.content))
        self.assertEqual(result.getpixel((2, 0)), (255, 0, 0))

        metadata_response = self.client.post(
            "/api/metadata/read",
            files={"file": ("output.png", response.content, "image/png")},
        )
        metadata = metadata_response.json()
        self.assertFalse(_metadata_has_exif(metadata))
        self.assertFalse(_metadata_has_group(metadata, "XMP"))
        self.assertFalse(_metadata_has_group(metadata, "ICC_Profile"))

    def test_randomize_metadata_payload_edits_dates(self) -> None:
        image = Image.new("RGB", (3, 2), "black")

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.jpg", _save_jpeg_with_exif(image), "image/jpeg")},
            data={
                "metadata": json.dumps(
                    {
                        "created_at": "2026-05-28T10:30",
                        "taken_at": "2025-04-03T02:01:59",
                    }
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

        self.assertEqual(_metadata_value(metadata, "IFD0", "ModifyDate"), "2026:05:28 10:30:00")
        self.assertEqual(_metadata_value(metadata, "ExifIFD", "DateTimeOriginal"), "2025:04:03 02:01:59")
        self.assertEqual(_metadata_value(metadata, "ExifIFD", "CreateDate"), "2025:04:03 02:01:59")

    def test_randomize_metadata_payload_removes_dates(self) -> None:
        image = Image.new("RGB", (3, 2), "black")

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.jpg", _save_jpeg_with_exif(image), "image/jpeg")},
            data={
                "metadata": json.dumps({"created_at": "", "taken_at": ""}),
                "output_format": "JPEG",
            },
        )

        self.assertEqual(response.status_code, 200)

        metadata_response = self.client.post(
            "/api/metadata/read",
            files={"file": ("output.jpg", response.content, "image/jpeg")},
        )
        metadata = metadata_response.json()

        self.assertNotIn("IFD0.ModifyDate", _metadata_keys(metadata))
        self.assertNotIn("ExifIFD.DateTimeOriginal", _metadata_keys(metadata))
        self.assertNotIn("ExifIFD.CreateDate", _metadata_keys(metadata))

    def test_randomize_metadata_payload_accepts_advanced_edits(self) -> None:
        image = Image.new("RGB", (3, 2), "black")

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.jpg", _save_jpeg_with_exif(image), "image/jpeg")},
            data={
                "metadata": json.dumps(
                    {
                        "advanced_edits": [
                            {"action": "set", "tag": "IFD0:Make", "value": "OpenAI Camera"},
                            {"action": "remove", "tag": "IFD0:Artist"},
                        ]
                    }
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

        self.assertEqual(_metadata_value(metadata, "IFD0", "Make"), "OpenAI Camera")
        self.assertNotIn("IFD0.Artist", _metadata_keys(metadata))

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

        self.assertNotIn("IFD0.Artist", _metadata_keys(metadata))
        self.assertEqual(_metadata_value(metadata, "IFD0", "Software"), "Image Randomizer")

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

        self.assertFalse(_metadata_has_gps(metadata))
        self.assertFalse(_metadata_has_group(metadata, "XMP"))
        self.assertEqual(_metadata_value(metadata, "IFD0", "Software"), "Image Randomizer")

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

        self.assertFalse(_metadata_has_exif(metadata))
        self.assertFalse(_metadata_has_group(metadata, "XMP"))
        self.assertFalse(_metadata_has_group(metadata, "ICC_Profile"))

    def test_randomize_requires_recipe_object(self) -> None:
        image = Image.new("RGB", (3, 2), "black")

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.png", _save_png(image), "image/png")},
            data={"recipe": json.dumps([{"name": "hmirror"}])},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "recipe must be a JSON object")

    def test_randomize_requires_metadata_object(self) -> None:
        image = Image.new("RGB", (3, 2), "black")

        response = self.client.post(
            "/api/randomize",
            files={"file": ("input.png", _save_png(image), "image/png")},
            data={"metadata": json.dumps([{"strip_all": True}])},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "metadata must be a JSON object")


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
    exif[ExifTags.Base.DateTime] = "2024:01:02 03:04:05"
    exif[ExifTags.Base.DateTimeOriginal] = "2024:01:02 03:04:05"
    exif[ExifTags.Base.DateTimeDigitized] = "2024:01:02 03:04:05"

    buffer = BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def _fake_exiftool_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    if command == ["exiftool", "-ver"]:
        return subprocess.CompletedProcess(command, 0, stdout="12.76\n", stderr="")

    if len(command) >= 6 and command[:-1] == ["exiftool", "-json", "-G1", "-a", "-s"]:
        try:
            payload = [_fake_exiftool_payload(Path(command[-1]))]
        except Exception as exc:
            return subprocess.CompletedProcess(command, 1, stdout="", stderr=str(exc))
        return subprocess.CompletedProcess(command, 0, stdout=json.dumps(payload), stderr="")

    if len(command) >= 4 and command[0:2] == ["exiftool", "-overwrite_original"]:
        try:
            _fake_apply_exiftool_write(Path(command[-1]), command[2:-1])
        except Exception as exc:
            return subprocess.CompletedProcess(command, 1, stdout="", stderr=str(exc))
        return subprocess.CompletedProcess(command, 0, stdout="1 image files updated\n", stderr="")

    return subprocess.CompletedProcess(command, 1, stdout="", stderr="unexpected exiftool command")


def _fake_exiftool_payload(path: Path) -> dict[str, object]:
    image = Image.open(path)
    payload: dict[str, object] = {
        "SourceFile": str(path),
        "File:FileType": image.format,
        "File:ImageWidth": image.width,
        "File:ImageHeight": image.height,
        "Composite:ImageSize": f"{image.width}x{image.height}",
    }

    exif = image.getexif()
    for tag_id, value in exif.items():
        if tag_id == ExifTags.IFD.GPSInfo:
            gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
            for gps_tag_id, gps_value in gps.items():
                tag = ExifTags.GPSTAGS.get(gps_tag_id, str(gps_tag_id))
                payload[f"GPS:{tag}"] = _fake_exiftool_json_value(gps_value)
            continue

        tag = ExifTags.TAGS.get(tag_id, str(tag_id))
        if tag == "DateTime":
            tag = "ModifyDate"
        elif tag == "DateTimeDigitized":
            tag = "CreateDate"
        group = "ExifIFD" if tag in {"DateTimeOriginal", "CreateDate"} else "IFD0"
        payload[f"{group}:{tag}"] = _fake_exiftool_json_value(value)

    for key in ("XML:com.adobe.xmp", "xmp"):
        value = image.info.get(key)
        if value is not None:
            payload[f"XMP:{key}"] = _fake_exiftool_json_value(value)

    profile = image.info.get("icc_profile")
    if isinstance(profile, bytes):
        payload["ICC_Profile:ProfileBytes"] = len(profile)

    return payload


def _fake_apply_exiftool_write(path: Path, args: list[str]) -> None:
    image = Image.open(path)
    image.load()
    image_format = image.format or path.suffix.removeprefix(".").upper()
    exif = image.getexif()
    info = dict(image.info)

    for arg in args:
        if not arg.startswith("-") or "=" not in arg:
            continue
        tag, value = arg[1:].split("=", 1)
        if tag == "all":
            exif = Image.Exif()
            info = {}
            continue
        if tag == "GPS:all" or tag.startswith("XMP-exif:GPS") or tag in {"XMP:Geotag"}:
            if ExifTags.IFD.GPSInfo in exif:
                del exif[ExifTags.IFD.GPSInfo]
            for key in ("XML:com.adobe.xmp", "xmp"):
                if key in info and "GPS" in str(info[key]):
                    info.pop(key, None)
            continue

        tag_id = _fake_exiftool_tag_id(tag)
        if tag_id is None:
            continue
        if value:
            exif[tag_id] = value
        elif tag_id in exif:
            del exif[tag_id]

    save_kwargs: dict[str, object] = {}
    if exif:
        save_kwargs["exif"] = exif.tobytes()

    icc_profile = info.get("icc_profile")
    if isinstance(icc_profile, bytes):
        save_kwargs["icc_profile"] = icc_profile

    if image_format == "PNG":
        png_info = PngImagePlugin.PngInfo()
        for key in ("XML:com.adobe.xmp", "xmp"):
            info_value = info.get(key)
            if isinstance(info_value, bytes):
                info_value = info_value.decode("utf-8", errors="ignore")
            if isinstance(info_value, str):
                png_info.add_text(key, info_value)
        save_kwargs["pnginfo"] = png_info

    image.info.clear()
    image.info.update(info)
    image.save(path, format=image_format, **save_kwargs)


def _fake_exiftool_tag_id(tag: str) -> int | None:
    normalized = tag.split(":", 1)[-1]
    tag_ids = {
        "Artist": ExifTags.Base.Artist,
        "Creator": ExifTags.Base.Artist,
        "Software": ExifTags.Base.Software,
        "CreatorTool": ExifTags.Base.Software,
        "ModifyDate": ExifTags.Base.DateTime,
        "DateTime": ExifTags.Base.DateTime,
        "DateTimeOriginal": ExifTags.Base.DateTimeOriginal,
        "CreateDate": ExifTags.Base.DateTimeDigitized,
        "DateTimeDigitized": ExifTags.Base.DateTimeDigitized,
        "Make": ExifTags.Base.Make,
    }
    return tag_ids.get(normalized)


def _fake_exiftool_json_value(value: object) -> object:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()
    if isinstance(value, tuple):
        return [_fake_exiftool_json_value(item) for item in value]
    return value


def _metadata_item(metadata: list[dict[str, object]], group: str, tag: str) -> dict[str, object]:
    for item in metadata:
        if item["group"] == group and item["tag"] == tag:
            return item
    raise AssertionError(f"metadata item not found: {group}.{tag}")


def _metadata_value(metadata: list[dict[str, object]], group: str, tag: str) -> object:
    return _metadata_item(metadata, group, tag)["value"]


def _metadata_keys(metadata: list[dict[str, object]]) -> set[str]:
    return {f"{item['group']}.{item['tag']}" for item in metadata}


def _metadata_has_group(metadata: list[dict[str, object]], group: str) -> bool:
    return any(item["group"] == group for item in metadata)


def _metadata_has_exif(metadata: list[dict[str, object]]) -> bool:
    return any(item["group"] in {"ExifIFD", "GPS", "IFD0"} for item in metadata)


def _metadata_has_gps(metadata: list[dict[str, object]]) -> bool:
    return any(
        "GPS" in str(item["group"]) or "GPS" in str(item["tag"]) or "GPS" in str(item["value"])
        for item in metadata
    )
