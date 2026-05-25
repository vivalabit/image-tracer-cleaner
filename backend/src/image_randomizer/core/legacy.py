from __future__ import annotations

from collections.abc import Iterable
from urllib.parse import parse_qsl

from image_randomizer.core.models import Operation
from image_randomizer.core.registry import get_method_names, normalize_method_name


ENABLED_VALUES = frozenset({"1", "true", "y", "yes", "on"})


def parse_legacy_query_string(query_string: str) -> list[Operation]:
    return parse_legacy_operation_pairs(parse_qsl(query_string, keep_blank_values=True))


def parse_legacy_operation_pairs(pairs: Iterable[tuple[str, str]]) -> list[Operation]:
    method_names = get_method_names()
    operations: list[Operation] = []

    for raw_name, raw_value in pairs:
        name = normalize_method_name(raw_name)
        value = raw_value.strip().lower()
        if name in method_names and value in ENABLED_VALUES:
            operations.append(Operation(name=name))

    return operations
