from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from image_randomizer.core.exiftool_engine import ExifToolEngine, ExifToolError

EXIFTOOL_METADATA_ARGS = ("-json", "-G1", "-a", "-s")
READ_ONLY_GROUPS = frozenset({"Composite", "ExifTool", "File", "SourceFile", "System"})


def read_image_metadata(
    data: bytes,
    *,
    suffix: str = ".bin",
    engine: ExifToolEngine | None = None,
) -> list[dict[str, object]]:
    exiftool = engine if engine is not None else ExifToolEngine()
    try:
        payload = exiftool.read_json(data, EXIFTOOL_METADATA_ARGS, suffix=suffix)
    except ExifToolError as exc:
        raise ValueError(str(exc)) from exc

    return normalize_exiftool_metadata(payload)


def normalize_exiftool_metadata(payload: list[dict[str, Any]]) -> list[dict[str, object]]:
    metadata: list[dict[str, object]] = []
    for item in payload:
        for raw_key, value in item.items():
            group, tag = split_exiftool_key(raw_key)
            if not tag or tag == "SourceFile":
                continue

            metadata.append(
                {
                    "group": group,
                    "tag": tag,
                    "label": label_from_tag(tag),
                    "value": normalize_json_value(value),
                    "writable": is_writable_tag(group),
                }
            )
    return metadata


def split_exiftool_key(raw_key: str) -> tuple[str, str]:
    key = raw_key.strip()
    if key.startswith("[") and "]" in key:
        group, tag = key[1:].split("]", 1)
        return group.strip() or "Unknown", tag.strip()

    if ":" in key:
        group, tag = key.split(":", 1)
        return group.strip() or "Unknown", tag.strip()

    return "Unknown", key


def label_from_tag(tag: str) -> str:
    if not tag:
        return ""

    label = tag.replace("_", " ").replace("-", " ")
    chunks: list[str] = []
    for index, char in enumerate(label):
        previous = label[index - 1] if index > 0 else ""
        next_char = label[index + 1] if index + 1 < len(label) else ""
        should_split = (
            index > 0
            and char.isupper()
            and previous not in {" ", ":", "."}
            and (previous.islower() or next_char.islower())
        )
        if should_split:
            chunks.append(" ")
        chunks.append(char)

    return "".join(chunks).strip()


def normalize_json_value(value: object) -> object:
    if value is None or isinstance(value, str | int | float | bool):
        return value

    if isinstance(value, list):
        return [normalize_json_value(item) for item in value]

    if isinstance(value, Mapping):
        return {str(key): normalize_json_value(item) for key, item in value.items()}

    return str(value)


def is_writable_tag(group: str) -> bool:
    return group not in READ_ONLY_GROUPS
