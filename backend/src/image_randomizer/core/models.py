from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Operation:
    name: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class NumericRange:
    min: int | float
    max: int | float


@dataclass(frozen=True)
class MethodParameter:
    name: str
    type: str
    title: str
    description: str = ""
    default: Any | None = None
    choices: tuple[Any, ...] = ()
    value_range: NumericRange | None = None
    random_default: NumericRange | None = None


@dataclass(frozen=True)
class MethodDefinition:
    name: str
    title: str
    description: str
    legacy_name: str
    parameters: tuple[MethodParameter, ...] = ()
    has_settings: bool = True
    reversible: bool = False
