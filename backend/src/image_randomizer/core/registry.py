from __future__ import annotations

from image_randomizer.core.models import MethodDefinition


METHOD_DEFINITIONS: tuple[MethodDefinition, ...] = (
    MethodDefinition(
        name="hmirror",
        title="Horizontal mirror",
        description="Flip the image horizontally.",
        reversible=True,
    ),
    MethodDefinition(
        name="vmirror",
        title="Vertical mirror",
        description="Flip the image vertically.",
        reversible=True,
    ),
    MethodDefinition(
        name="invert",
        title="Invert colors",
        description="Invert RGB color channels.",
        reversible=True,
    ),
    MethodDefinition(
        name="grayscale",
        title="Grayscale",
        description="Convert the image to grayscale.",
        reversible=False,
    ),
    MethodDefinition(
        name="crop",
        title="Crop",
        description="Randomly crop 5-15 percent from each image side by default.",
        reversible=False,
    ),
    MethodDefinition(
        name="fixresize",
        title="Fixed resize",
        description="Resize 75-115 percent using the same X/Y scale by default.",
        reversible=False,
    ),
    MethodDefinition(
        name="resize",
        title="Unfixed resize",
        description="Resize 75-115 percent using separate X/Y scales by default.",
        reversible=False,
    ),
    MethodDefinition(
        name="interference",
        title="Noise",
        description="Add random RGB noise. Legacy UI exposed this, but PHP API did not implement it.",
        reversible=False,
    ),
    MethodDefinition(
        name="rotate",
        title="Rotate",
        description="Rotate -15..15 degrees by default.",
        reversible=False,
    ),
    MethodDefinition(
        name="border",
        title="Border",
        description="Add a 5-15 px random-color border by default.",
        reversible=False,
    ),
    MethodDefinition(
        name="sharp",
        title="Contrast",
        description="Apply a random contrast change by default.",
        reversible=False,
    ),
    MethodDefinition(
        name="blur",
        title="Blur",
        description="Apply a random blur filter by default.",
        reversible=False,
    ),
    MethodDefinition(
        name="eskiz",
        title="Sketch",
        description="Apply a sketch-like edge filter.",
        reversible=False,
    ),
    MethodDefinition(
        name="pixelization",
        title="Pixelization",
        description="Pixelate using a random 3-7 px block size by default.",
        reversible=False,
    ),
    MethodDefinition(
        name="move",
        title="Move",
        description="Wrap-shift the image by a random X/Y offset by default.",
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
