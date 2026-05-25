from __future__ import annotations

import unittest

from image_randomizer.core.legacy import parse_legacy_operation_pairs, parse_legacy_query_string


class LegacyParserTest(unittest.TestCase):
    def test_legacy_query_parser_keeps_operation_order(self) -> None:
        operations = parse_legacy_query_string("hmirror=y&crop=y&sharp=y")

        self.assertEqual([operation.name for operation in operations], ["hmirror", "crop", "sharp"])
        self.assertEqual([operation.params for operation in operations], [{}, {}, {}])

    def test_legacy_query_parser_ignores_control_and_disabled_values(self) -> None:
        operations = parse_legacy_query_string(
            "req=randomizeImage&path=picard.jpg&hmirror=y&crop=n&format=base64"
        )

        self.assertEqual([operation.name for operation in operations], ["hmirror"])

    def test_legacy_pair_parser_accepts_aliases(self) -> None:
        operations = parse_legacy_operation_pairs(
            [
                ("horizontal_mirror", "y"),
                ("noise", "true"),
                ("unknown", "y"),
            ]
        )

        self.assertEqual([operation.name for operation in operations], ["hmirror", "interference"])
