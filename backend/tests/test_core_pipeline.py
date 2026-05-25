from __future__ import annotations

import os
import sys
import unittest

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from image_randomizer.core.models import Operation
from image_randomizer.core.pipeline import apply_pipeline
from image_randomizer.core.registry import get_method_definitions


class CorePipelineTest(unittest.TestCase):
    def test_registry_keeps_legacy_method_names(self) -> None:
        names = {method.name for method in get_method_definitions()}

        self.assertIn("hmirror", names)
        self.assertIn("vmirror", names)
        self.assertIn("fixresize", names)
        self.assertIn("eskiz", names)
        self.assertIn("pixelization", names)

    def test_horizontal_mirror(self) -> None:
        image = Image.new("RGB", (4, 2), "black")
        image.putpixel((0, 0), (255, 0, 0))

        result = apply_pipeline(image, [Operation("hmirror")])

        self.assertEqual(result.size, (4, 2))
        self.assertEqual(result.getpixel((3, 0)), (255, 0, 0))

    def test_ordered_pipeline_applies_multiple_operations(self) -> None:
        image = Image.new("RGB", (4, 4), (10, 20, 30))

        result = apply_pipeline(
            image,
            [
                Operation("border", {"size": 2, "color": (1, 2, 3)}),
                Operation("fixresize", {"scale_pct": 50}),
            ],
        )

        self.assertEqual(result.size, (4, 4))

    def test_random_operations_are_reproducible_with_seed(self) -> None:
        image = Image.new("RGB", (16, 16), (10, 20, 30))
        operations = [Operation("crop"), Operation("rotate"), Operation("border")]

        first = apply_pipeline(image, operations, seed=42)
        second = apply_pipeline(image, operations, seed=42)

        self.assertEqual(first.size, second.size)
        self.assertEqual(first.tobytes(), second.tobytes())

    def test_move_preserves_size(self) -> None:
        image = Image.new("RGB", (8, 6), (10, 20, 30))

        result = apply_pipeline(image, [Operation("move", {"x": 3, "y": 2})])

        self.assertEqual(result.size, image.size)


if __name__ == "__main__":
    unittest.main()
