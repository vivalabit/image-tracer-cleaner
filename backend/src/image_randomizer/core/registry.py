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
        description="Add random RGB noise. Legacy UI exposed this, but PHP API did not implement it.",
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
}


def normalize_method_name(name: str) -> str:
    normalized = name.strip().lower()
    return ALIASES.get(normalized, normalized)


def get_method_definitions() -> tuple[MethodDefinition, ...]:
    return METHOD_DEFINITIONS


def get_method_names() -> frozenset[str]:
    return frozenset(method.name for method in METHOD_DEFINITIONS)
