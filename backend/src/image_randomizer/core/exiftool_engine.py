from __future__ import annotations

import json
import subprocess
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ExifToolError(RuntimeError):
    """Base exception for ExifToolEngine failures."""


class ExifToolUnavailableError(ExifToolError):
    """Raised when exiftool cannot be executed or fails the version check."""


class ExifToolCommandError(ExifToolError):
    def __init__(
        self,
        message: str,
        *,
        command: Sequence[str],
        returncode: int,
        stdout: str,
        stderr: str,
    ) -> None:
        super().__init__(message)
        self.command = tuple(command)
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


@dataclass(frozen=True)
class ExifToolResult:
    data: bytes
    stdout: str
    stderr: str


class ExifToolEngine:
    def __init__(self, executable: str = "exiftool", *, timeout: float = 15.0) -> None:
        self.executable = executable
        self.timeout = timeout

    def check_available(self) -> str:
        process = self._run([self.executable, "-ver"])
        if process.returncode != 0:
            raise ExifToolUnavailableError(
                f"exiftool -ver failed with exit code {process.returncode}: {process.stderr.strip()}"
            )

        version = process.stdout.strip()
        if not version:
            raise ExifToolUnavailableError("exiftool -ver returned an empty version")
        return version

    def run_on_blob(
        self,
        data: bytes,
        args: Sequence[str],
        *,
        suffix: str = ".bin",
    ) -> ExifToolResult:
        normalized_args = self._normalize_args(args)
        self.check_available()

        with tempfile.TemporaryDirectory(prefix="image-randomizer-exiftool-") as temp_dir:
            input_path = Path(temp_dir) / f"input{self._normalize_suffix(suffix)}"
            input_path.write_bytes(data)

            command = [self.executable, *normalized_args, str(input_path)]
            process = self._run(command)
            if process.returncode != 0:
                raise ExifToolCommandError(
                    f"exiftool failed with exit code {process.returncode}: {process.stderr.strip()}",
                    command=command,
                    returncode=process.returncode,
                    stdout=process.stdout,
                    stderr=process.stderr,
                )

            return ExifToolResult(
                data=input_path.read_bytes(),
                stdout=process.stdout,
                stderr=process.stderr,
            )

    def read_json(self, data: bytes, *, suffix: str = ".bin") -> list[dict[str, Any]]:
        result = self.run_on_blob(data, ["-json"], suffix=suffix)
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise ExifToolError("exiftool -json returned invalid JSON") from exc

        if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
            raise ExifToolError("exiftool -json returned an unexpected payload")
        return payload

    def write_tags(self, data: bytes, tag_args: Sequence[str], *, suffix: str = ".bin") -> bytes:
        result = self.run_on_blob(
            data,
            ["-overwrite_original", *self._normalize_args(tag_args)],
            suffix=suffix,
        )
        return result.data

    def _run(self, command: Sequence[str]) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                list(command),
                capture_output=True,
                text=True,
                check=False,
                shell=False,
                timeout=self.timeout,
            )
        except FileNotFoundError as exc:
            raise ExifToolUnavailableError(f"exiftool executable not found: {self.executable}") from exc
        except subprocess.TimeoutExpired as exc:
            raise ExifToolUnavailableError(f"exiftool timed out after {self.timeout:g}s") from exc

    @staticmethod
    def _normalize_args(args: Sequence[str]) -> list[str]:
        if isinstance(args, str):
            raise TypeError("ExifTool arguments must be a sequence, not a shell command string")
        return [str(arg) for arg in args]

    @staticmethod
    def _normalize_suffix(suffix: str) -> str:
        name = Path(str(suffix).strip() or ".bin").name
        if not name.startswith("."):
            name = f".{name}"
        return name
