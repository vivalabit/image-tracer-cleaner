from __future__ import annotations

import unittest

from image_randomizer.core.metadata import build_metadata_write_args, normalize_exiftool_metadata


class MetadataTest(unittest.TestCase):
    def test_normalize_exiftool_metadata_returns_flat_list(self) -> None:
        metadata = normalize_exiftool_metadata(
            [
                {
                    "SourceFile": "/tmp/input.jpg",
                    "File:FileType": "JPEG",
                    "IFD0:Artist": "Image Randomizer Test",
                    "ExifIFD:DateTimeOriginal": "2024:01:02 03:04:05",
                    "XMP:XML:com.adobe.xmp": {"GPSLatitude": "46,12N"},
                }
            ]
        )

        self.assertEqual(
            metadata,
            [
                {
                    "group": "File",
                    "tag": "FileType",
                    "label": "File Type",
                    "value": "JPEG",
                    "writable": False,
                },
                {
                    "group": "IFD0",
                    "tag": "Artist",
                    "label": "Artist",
                    "value": "Image Randomizer Test",
                    "writable": True,
                },
                {
                    "group": "ExifIFD",
                    "tag": "DateTimeOriginal",
                    "label": "Date Time Original",
                    "value": "2024:01:02 03:04:05",
                    "writable": True,
                },
                {
                    "group": "XMP",
                    "tag": "XML:com.adobe.xmp",
                    "label": "XML:com.adobe.xmp",
                    "value": {"GPSLatitude": "46,12N"},
                    "writable": True,
                },
            ],
        )

    def test_normalize_exiftool_metadata_accepts_bracket_group_keys(self) -> None:
        metadata = normalize_exiftool_metadata([{"[IFD0]Software": "Image Randomizer"}])

        self.assertEqual(metadata[0]["group"], "IFD0")
        self.assertEqual(metadata[0]["tag"], "Software")

    def test_build_metadata_write_args_uses_exiftool_tags(self) -> None:
        args = build_metadata_write_args(
            {
                "strip_all": True,
                "creator": "Image Randomizer Test",
                "software": "Image Randomizer",
                "created_at": "2026-05-28T10:30",
                "taken_at": "2025:04:03 02:01:59",
            }
        )

        self.assertEqual(args[0], "-all=")
        self.assertIn("-EXIF:Artist=Image Randomizer Test", args)
        self.assertIn("-XMP-dc:Creator=Image Randomizer Test", args)
        self.assertIn("-EXIF:Software=Image Randomizer", args)
        self.assertIn("-EXIF:ModifyDate=2026:05:28 10:30:00", args)
        self.assertIn("-EXIF:DateTimeOriginal=2025:04:03 02:01:59", args)
        self.assertIn("-EXIF:CreateDate=2025:04:03 02:01:59", args)

    def test_build_metadata_write_args_removes_gps_groups(self) -> None:
        args = build_metadata_write_args({"strip_gps": True})

        self.assertIn("-GPS:all=", args)
        self.assertIn("-XMP:Geotag=", args)
        self.assertIn("-XMP-exif:GPSLatitude=", args)
        self.assertIn("-XMP-exif:GPSLongitude=", args)

    def test_build_metadata_write_args_supports_advanced_edits(self) -> None:
        args = build_metadata_write_args(
            {
                "advanced_edits": [
                    {"action": "set", "tag": "IFD0:Make", "value": "OpenAI"},
                    {"action": "remove", "group": "IFD0", "tag": "Artist"},
                    {"action": "remove", "tag": "XMP:XML:com.adobe.xmp"},
                ]
            }
        )

        self.assertEqual(args, ["-IFD0:Make=OpenAI", "-IFD0:Artist=", "-XMP:XML:com.adobe.xmp="])

    def test_build_metadata_write_args_rejects_unsafe_advanced_tag(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported characters"):
            build_metadata_write_args(
                {"advanced_edits": [{"action": "remove", "tag": "IFD0:Artist=bad"}]}
            )


if __name__ == "__main__":
    unittest.main()
