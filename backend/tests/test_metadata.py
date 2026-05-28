from __future__ import annotations

import unittest

from image_randomizer.core.metadata import normalize_exiftool_metadata


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


if __name__ == "__main__":
    unittest.main()
