from __future__ import annotations

import base64
import hashlib
from collections.abc import Mapping
from io import BytesIO
from typing import Any

from PIL import ExifTags, Image, IptcImagePlugin, UnidentifiedImageError


def read_image_metadata(data: bytes) -> dict[str, object]:
    try:
        image = Image.open(BytesIO(data))
    except UnidentifiedImageError as exc:
        raise ValueError("file must be a valid image") from exc

    exif = read_exif(image)
    xmp = read_xmp(image)

    return {
        "format": image.format,
        "dimensions": {"width": image.width, "height": image.height},
        "exif": exif,
        "iptc": read_iptc(image),
        "xmp": xmp,
        "gps_presence": has_gps_metadata(exif, xmp),
        "color_profile": read_color_profile(image.info),
        "file_hash": hashlib.sha256(data).hexdigest(),
    }


def read_exif(image: Image.Image) -> dict[str, object]:
    exif = image.getexif()
    if not exif:
        return {}

    result: dict[str, object] = {}
    for tag_id, value in exif.items():
        if tag_id == ExifTags.IFD.GPSInfo:
            gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
            if gps:
                result["GPSInfo"] = {
                    ExifTags.GPSTAGS.get(gps_tag_id, str(gps_tag_id)): to_json_value(gps_value)
                    for gps_tag_id, gps_value in gps.items()
                }
            continue

        tag_name = ExifTags.TAGS.get(tag_id, str(tag_id))
        result[tag_name] = to_json_value(value)

    return result


def read_iptc(image: Image.Image) -> dict[str, object]:
    try:
        iptc = IptcImagePlugin.getiptcinfo(image)
    except Exception:
        return {}

    if not iptc:
        return {}

    return {format_iptc_key(key): to_json_value(value) for key, value in iptc.items()}


def read_xmp(image: Image.Image) -> dict[str, object]:
    xmp: dict[str, object] = {}
    for key in ("XML:com.adobe.xmp", "xmp"):
        value = image.info.get(key)
        if value is not None:
            xmp[key] = to_json_value(value)
    return xmp


def read_color_profile(info: Mapping[str, Any]) -> dict[str, object] | None:
    profile = info.get("icc_profile")
    if not isinstance(profile, bytes):
        return None

    return {
        "present": True,
        "bytes": len(profile),
        "sha256": hashlib.sha256(profile).hexdigest(),
    }


def has_gps_metadata(exif: Mapping[str, object], xmp: Mapping[str, object]) -> bool:
    if exif.get("GPSInfo"):
        return True

    xmp_text = " ".join(str(value) for value in xmp.values())
    return any(marker in xmp_text for marker in ("GPS", "exif:GPS", "GPSLatitude", "GPSLongitude"))


def format_iptc_key(key: object) -> str:
    if isinstance(key, tuple):
        return ":".join(str(part) for part in key)
    return str(key)


def to_json_value(value: object) -> object:
    if value is None or isinstance(value, str | int | float | bool):
        return value

    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return {"base64": base64.b64encode(value).decode("ascii")}

    if isinstance(value, tuple | list):
        return [to_json_value(item) for item in value]

    if isinstance(value, Mapping):
        return {str(key): to_json_value(item) for key, item in value.items()}

    if hasattr(value, "numerator") and hasattr(value, "denominator"):
        try:
            return float(value)
        except ZeroDivisionError:
            return str(value)

    return str(value)
