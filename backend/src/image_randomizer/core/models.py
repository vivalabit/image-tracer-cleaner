from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Operation:
    name: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class MethodDefinition:
    name: str
    title: str
    description: str
    legacy_name: str | None = None
    has_settings: bool = True
    reversible: bool | None = None
