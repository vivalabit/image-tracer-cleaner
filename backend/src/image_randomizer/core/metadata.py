from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from image_randomizer.core.exiftool_engine import ExifToolEngine, ExifToolError

EXIFTOOL_METADATA_ARGS = ("-json", "-G1", "-a", "-s")
READ_ONLY_GROUPS = frozenset({"Composite", "ExifTool", "File", "SourceFile", "System"})
ADVANCED_EDIT_KEYS = ("advanced_edits", "advanced", "edits")
TAG_NAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]*")
GPS_REMOVE_ARGS = (
    "-GPS:all=",
    "-XMP:Geotag=",
    "-XMP-exif:GPSAltitude=",
    "-XMP-exif:GPSAltitudeRef=",
    "-XMP-exif:GPSAreaInformation=",
    "-XMP-exif:GPSDOP=",
    "-XMP-exif:GPSDateTime=",
    "-XMP-exif:GPSDestBearing=",
    "-XMP-exif:GPSDestBearingRef=",
    "-XMP-exif:GPSDestDistance=",
    "-XMP-exif:GPSDestDistanceRef=",
    "-XMP-exif:GPSDestLatitude=",
    "-XMP-exif:GPSDestLongitude=",
    "-XMP-exif:GPSDifferential=",
    "-XMP-exif:GPSHPositioningError=",
    "-XMP-exif:GPSImgDirection=",
    "-XMP-exif:GPSImgDirectionRef=",
    "-XMP-exif:GPSLatitude=",
    "-XMP-exif:GPSLongitude=",
    "-XMP-exif:GPSMapDatum=",
    "-XMP-exif:GPSMeasureMode=",
    "-XMP-exif:GPSProcessingMethod=",
    "-XMP-exif:GPSSatellites=",
    "-XMP-exif:GPSSpeed=",
    "-XMP-exif:GPSSpeedRef=",
    "-XMP-exif:GPSStatus=",
    "-XMP-exif:GPSTimeStamp=",
    "-XMP-exif:GPSTrack=",
    "-XMP-exif:GPSTrackRef=",
)
SIMPLE_METADATA_TAGS = {
    "creator": ("EXIF:Artist", "XMP-dc:Creator"),
    "software": ("EXIF:Software", "XMP-xmp:CreatorTool"),
    "created_at": ("EXIF:ModifyDate", "XMP-xmp:ModifyDate"),
    "taken_at": ("EXIF:DateTimeOriginal", "EXIF:CreateDate", "XMP-exif:DateTimeOriginal", "XMP-xmp:CreateDate"),
}


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


def apply_metadata_edits(
    data: bytes,
    payloads: Mapping[str, Any] | Sequence[Mapping[str, Any]],
    *,
    suffix: str = ".bin",
    engine: ExifToolEngine | None = None,
) -> bytes:
    args = build_metadata_write_args(payloads)
    if not args:
        return data

    exiftool = engine if engine is not None else ExifToolEngine()
    try:
        return exiftool.write_tags(data, args, suffix=suffix)
    except ExifToolError as exc:
        raise ValueError(str(exc)) from exc


def build_metadata_write_args(
    payloads: Mapping[str, Any] | Sequence[Mapping[str, Any]],
) -> list[str]:
    args: list[str] = []
    for payload in iter_metadata_payloads(payloads):
        args.extend(build_metadata_payload_args(payload))
    return args


def iter_metadata_payloads(
    payloads: Mapping[str, Any] | Sequence[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    if isinstance(payloads, Mapping):
        return [payloads]
    if isinstance(payloads, str):
        raise ValueError("metadata edits must be JSON objects")

    result: list[Mapping[str, Any]] = []
    for payload in payloads:
        if not isinstance(payload, Mapping):
            raise ValueError("metadata edits must be JSON objects")
        result.append(payload)
    return result


def build_metadata_payload_args(payload: Mapping[str, Any]) -> list[str]:
    args: list[str] = []
    strip_all = coerce_metadata_bool(payload.get("strip_all"), default=False)
    strip_gps = coerce_metadata_bool(payload.get("strip_gps"), default=False)

    if strip_all:
        args.append("-all=")
    elif strip_gps:
        args.extend(GPS_REMOVE_ARGS)

    for field, tags in SIMPLE_METADATA_TAGS.items():
        if field not in payload:
            continue
        value = normalize_simple_metadata_value(field, payload[field])
        args.extend(format_tag_assignment(tag, value) for tag in tags)

    args.extend(build_advanced_edit_args(payload))
    return args


def build_advanced_edit_args(payload: Mapping[str, Any]) -> list[str]:
    edits = None
    for key in ADVANCED_EDIT_KEYS:
        if key in payload:
            edits = payload[key]
            break

    if edits is None:
        return []
    if not isinstance(edits, list):
        raise ValueError("advanced metadata edits must be an array")

    args: list[str] = []
    for edit in edits:
        if not isinstance(edit, Mapping):
            raise ValueError("advanced metadata edits must contain objects")
        action = edit.get("action")
        if action not in {"set", "remove"}:
            raise ValueError("advanced metadata edit action must be set or remove")

        tag = normalize_advanced_tag(edit)
        if action == "remove":
            args.append(format_tag_assignment(tag, ""))
            continue

        if "value" not in edit:
            raise ValueError("advanced metadata set edit must contain value")
        args.append(format_tag_assignment(tag, format_metadata_value(edit["value"])))

    return args


def normalize_advanced_tag(edit: Mapping[str, Any]) -> str:
    raw_tag = edit.get("tag")
    raw_group = edit.get("group")
    if not isinstance(raw_tag, str) or not raw_tag.strip():
        raise ValueError("advanced metadata edit tag must be a non-empty string")

    tag = raw_tag.strip()
    if isinstance(raw_group, str) and raw_group.strip() and ":" not in tag:
        tag = f"{raw_group.strip()}:{tag}"

    if not TAG_NAME_PATTERN.fullmatch(tag):
        raise ValueError("advanced metadata edit tag contains unsupported characters")
    return tag


def normalize_simple_metadata_value(field: str, value: object) -> str:
    if field in {"created_at", "taken_at"}:
        return normalize_metadata_datetime(value)
    return str(value)


def normalize_metadata_datetime(value: object) -> str:
    text = str(value).strip()
    if not text:
        return ""

    for date_format in (
        "%Y:%m:%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ):
        try:
            parsed = datetime.strptime(text, date_format)
        except ValueError:
            continue
        return parsed.strftime("%Y:%m:%d %H:%M:%S")

    raise ValueError("metadata date values must use YYYY-MM-DDTHH:MM or YYYY:MM:DD HH:MM:SS")


def format_tag_assignment(tag: str, value: str) -> str:
    return f"-{tag}={value}"


def format_metadata_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str | int | float):
        return str(value)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def coerce_metadata_bool(value: object, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return bool(value)


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
