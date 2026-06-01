from __future__ import annotations

from image_randomizer.core.models import MethodDefinition, MethodParameter, NumericRange


def _range(minimum: int | float, maximum: int | float) -> NumericRange:
    return NumericRange(min=minimum, max=maximum)


def _parameter(
    name: str,
    type_: str,
    title: str,
    *,
    description: str = "",
    default: object | None = None,
    choices: tuple[object, ...] = (),
    value_range: NumericRange | None = None,
    random_default: NumericRange | None = None,
) -> MethodParameter:
    return MethodParameter(
        name=name,
        type=type_,
        title=title,
        description=description,
        default=default,
        choices=choices,
        value_range=value_range,
        random_default=random_default,
    )


METHOD_DEFINITIONS: tuple[MethodDefinition, ...] = (
    MethodDefinition(
        name="hmirror",
        legacy_name="hmirror",
        title="Horizontal mirror",
        description="Flip the image horizontally.",
        has_settings=False,
        reversible=True,
    ),
    MethodDefinition(
        name="vmirror",
        legacy_name="vmirror",
        title="Vertical mirror",
        description="Flip the image vertically.",
        has_settings=False,
        reversible=True,
    ),
    MethodDefinition(
        name="invert",
        legacy_name="invert",
        title="Invert colors",
        description="Invert RGB color channels.",
        has_settings=False,
        reversible=True,
    ),
    MethodDefinition(
        name="grayscale",
        legacy_name="grayscale",
        title="Grayscale",
        description="Convert the image to grayscale.",
        has_settings=False,
        reversible=False,
    ),
    MethodDefinition(
        name="saturation",
        legacy_name="saturation",
        title="Saturation",
        description="Adjust color saturation by a small random amount by default.",
        parameters=(
            _parameter(
                "amount",
                "number",
                "Amount",
                description="Saturation delta in percent.",
                value_range=_range(-100, 200),
                random_default=_range(-25, 25),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="brightness",
        legacy_name="brightness",
        title="Brightness",
        description="Adjust brightness by a small random amount by default.",
        parameters=(
            _parameter(
                "amount",
                "number",
                "Amount",
                description="Brightness delta in percent.",
                value_range=_range(-100, 100),
                random_default=_range(-10, 10),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="gamma",
        legacy_name="gamma",
        title="Gamma",
        description="Apply a gamma curve with a subtle random factor by default.",
        parameters=(
            _parameter(
                "gamma",
                "number",
                "Gamma",
                description="Gamma exponent. 1 keeps the current tonal curve.",
                value_range=_range(0.1, 5),
                random_default=_range(0.85, 1.15),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="hue_shift",
        legacy_name="hue_shift",
        title="Hue shift",
        description="Rotate hue by -15..15 degrees by default.",
        parameters=(
            _parameter(
                "degrees",
                "number",
                "Degrees",
                description="Hue rotation in degrees.",
                value_range=_range(-180, 180),
                random_default=_range(-15, 15),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="crop",
        legacy_name="crop",
        title="Crop",
        description="Randomly crop 5-15 percent from each image side by default.",
        parameters=(
            _parameter(
                "top_pct",
                "integer",
                "Top crop",
                description="Percent to remove from the top edge.",
                value_range=_range(0, 95),
                random_default=_range(5, 15),
            ),
            _parameter(
                "bottom_pct",
                "integer",
                "Bottom crop",
                description="Percent to remove from the bottom edge.",
                value_range=_range(0, 95),
                random_default=_range(5, 15),
            ),
            _parameter(
                "left_pct",
                "integer",
                "Left crop",
                description="Percent to remove from the left edge.",
                value_range=_range(0, 95),
                random_default=_range(5, 15),
            ),
            _parameter(
                "right_pct",
                "integer",
                "Right crop",
                description="Percent to remove from the right edge.",
                value_range=_range(0, 95),
                random_default=_range(5, 15),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="fixresize",
        legacy_name="fixresize",
        title="Fixed resize",
        description="Resize 75-115 percent using the same X/Y scale by default.",
        parameters=(
            _parameter(
                "scale_pct",
                "integer",
                "Scale",
                description="Percent scale used for both axes.",
                value_range=_range(1, 1000),
                random_default=_range(75, 115),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="resize",
        legacy_name="resize",
        title="Unfixed resize",
        description="Resize 75-115 percent using separate X/Y scales by default.",
        parameters=(
            _parameter(
                "scale_x_pct",
                "integer",
                "X scale",
                description="Percent scale used for the horizontal axis.",
                value_range=_range(1, 1000),
                random_default=_range(75, 115),
            ),
            _parameter(
                "scale_y_pct",
                "integer",
                "Y scale",
                description="Percent scale used for the vertical axis.",
                value_range=_range(1, 1000),
                random_default=_range(75, 115),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="interference",
        legacy_name="interference",
        title="Noise",
        description="Add random RGB noise.",
        parameters=(
            _parameter(
                "strength",
                "integer",
                "Strength",
                description="Maximum random channel delta per pixel.",
                default=8,
                value_range=_range(0, 255),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="rotate",
        legacy_name="rotate",
        title="Rotate",
        description="Rotate -15..15 degrees by default.",
        parameters=(
            _parameter(
                "angle",
                "number",
                "Angle",
                description="Rotation angle in degrees.",
                random_default=_range(-15, 15),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="orientation_normalize",
        legacy_name="orientation_normalize",
        title="Normalize orientation",
        description="Apply EXIF orientation to pixels and clear the orientation flag.",
        has_settings=False,
        reversible=False,
    ),
    MethodDefinition(
        name="border",
        legacy_name="border",
        title="Border",
        description="Add a 5-15 px random-color border by default.",
        parameters=(
            _parameter(
                "size",
                "integer",
                "Size",
                description="Border size in pixels.",
                value_range=_range(0, 1000),
                random_default=_range(5, 15),
            ),
            _parameter(
                "color",
                "rgb_color",
                "Color",
                description="Border color. Omit it to use a random RGB color.",
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="sharp",
        legacy_name="sharp",
        title="Contrast",
        description="Apply a random contrast change by default.",
        parameters=(
            _parameter(
                "amount",
                "number",
                "Amount",
                description="Contrast delta in percent.",
                random_default=_range(-30, 30),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="sharpen",
        legacy_name="sharpen",
        title="Sharpen",
        description="Increase edge sharpness by a random amount by default.",
        parameters=(
            _parameter(
                "amount",
                "number",
                "Amount",
                description="Sharpness delta in percent.",
                value_range=_range(0, 200),
                random_default=_range(20, 80),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="blur",
        legacy_name="blur",
        title="Blur",
        description="Apply a random blur filter by default.",
        parameters=(
            _parameter(
                "type",
                "enum",
                "Type",
                description="Blur implementation. Omit it to choose randomly.",
                choices=("gaussian", "simple"),
            ),
            _parameter(
                "radius",
                "number",
                "Radius",
                description="Gaussian blur radius when type is gaussian.",
                default=1,
                value_range=_range(0, 100),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="eskiz",
        legacy_name="eskiz",
        title="Sketch",
        description="Apply a sketch-like edge filter.",
        has_settings=False,
        reversible=False,
    ),
    MethodDefinition(
        name="pixelization",
        legacy_name="pixelization",
        title="Pixelization",
        description="Pixelate using a random 3-7 px block size by default.",
        parameters=(
            _parameter(
                "block_size",
                "integer",
                "Block size",
                description="Pixel block size.",
                value_range=_range(1, 1000),
                random_default=_range(3, 7),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="move",
        legacy_name="move",
        title="Move",
        description="Wrap-shift the image by a random X/Y offset by default.",
        parameters=(
            _parameter(
                "x",
                "integer",
                "X offset",
                description="Horizontal wrap offset in pixels. Defaults to 0..image width.",
            ),
            _parameter(
                "y",
                "integer",
                "Y offset",
                description="Vertical wrap offset in pixels. Defaults to 0..image height.",
            ),
        ),
        reversible=True,
    ),
    MethodDefinition(
        name="jpeg_quality",
        legacy_name="jpeg_quality",
        title="JPEG quality jitter",
        description="Round-trip through JPEG at a random quality level by default.",
        parameters=(
            _parameter(
                "quality",
                "integer",
                "Quality",
                description="JPEG quality used for the intermediate compression pass.",
                value_range=_range(1, 100),
                random_default=_range(65, 92),
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="watermark",
        legacy_name="watermark",
        title="Watermark",
        description="Overlay deterministic brand text on the output image.",
        parameters=(
            _parameter(
                "text",
                "string",
                "Text",
                description="Watermark text. Empty text disables the overlay.",
                default="Image TC",
            ),
            _parameter(
                "position",
                "enum",
                "Position",
                description="Watermark anchor position.",
                default="bottom_right",
                choices=("bottom_right", "bottom_left", "top_right", "top_left", "center"),
            ),
            _parameter(
                "opacity",
                "integer",
                "Opacity",
                description="Watermark opacity in percent.",
                default=35,
                value_range=_range(0, 100),
            ),
            _parameter(
                "size_pct",
                "integer",
                "Text size",
                description="Font size as a percent of the shorter image side.",
                default=5,
                value_range=_range(1, 25),
            ),
            _parameter(
                "margin_pct",
                "integer",
                "Margin",
                description="Margin as a percent of the shorter image side.",
                default=3,
                value_range=_range(0, 25),
            ),
            _parameter(
                "color",
                "rgb_color",
                "Color",
                description="Watermark text color. Omit it to use white.",
            ),
        ),
        reversible=False,
    ),
    MethodDefinition(
        name="metadata",
        legacy_name="metadata",
        title="Metadata",
        description="Edit output metadata without changing pixels.",
        parameters=(
            _parameter(
                "strip_gps",
                "boolean",
                "Strip GPS",
                description="Remove GPS fields from EXIF/XMP metadata.",
                default=True,
            ),
            _parameter(
                "strip_all",
                "boolean",
                "Strip all",
                description="Remove all metadata before applying explicit metadata fields.",
                default=False,
            ),
            _parameter(
                "creator",
                "string",
                "Creator",
                description="Creator metadata. Empty removes the field.",
                default="",
            ),
            _parameter(
                "software",
                "string",
                "Software",
                description="Software metadata written to output.",
                default="Image Randomizer",
            ),
            _parameter(
                "created_at",
                "string",
                "Created date",
                description="EXIF DateTime value. Use YYYY-MM-DDTHH:MM or YYYY:MM:DD HH:MM:SS.",
                default="",
            ),
            _parameter(
                "taken_at",
                "string",
                "Taken date",
                description="EXIF DateTimeOriginal and DateTimeDigitized value.",
                default="",
            ),
        ),
        reversible=False,
    ),
)


ALIASES: dict[str, str] = {
    "horizontal_mirror": "hmirror",
    "vertical_mirror": "vmirror",
    "fixed_resize": "fixresize",
    "unfixed_resize": "resize",
    "contrast": "sharp",
    "noise": "interference",
    "sketch": "eskiz",
    "pixelate": "pixelization",
    "saturate": "saturation",
    "hue": "hue_shift",
    "orientation": "orientation_normalize",
    "normalize_orientation": "orientation_normalize",
    "jpeg_jitter": "jpeg_quality",
    "jpeg_quality_jitter": "jpeg_quality",
    "compression_jitter": "jpeg_quality",
    "text_overlay": "watermark",
    "watermark_overlay": "watermark",
}


def normalize_method_name(name: str) -> str:
    normalized = name.strip().lower()
    return ALIASES.get(normalized, normalized)


def get_method_definitions() -> tuple[MethodDefinition, ...]:
    return METHOD_DEFINITIONS


def get_method_names() -> frozenset[str]:
    return frozenset(method.name for method in METHOD_DEFINITIONS)
