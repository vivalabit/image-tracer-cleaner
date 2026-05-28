from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from image_randomizer.core.exiftool_engine import (
    ExifToolCommandError,
    ExifToolEngine,
    ExifToolUnavailableError,
)


class ExifToolEngineTest(unittest.TestCase):
    def test_check_available_runs_version_without_shell(self) -> None:
        calls: list[tuple[list[str], dict[str, object]]] = []

        def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0, stdout="12.76\n", stderr="")

        with patch("image_randomizer.core.exiftool_engine.subprocess.run", fake_run):
            version = ExifToolEngine().check_available()

        self.assertEqual(version, "12.76")
        self.assertEqual(calls[0][0], ["exiftool", "-ver"])
        self.assertIs(calls[0][1]["shell"], False)

    def test_check_available_wraps_missing_executable(self) -> None:
        def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            raise FileNotFoundError

        with patch("image_randomizer.core.exiftool_engine.subprocess.run", fake_run):
            with self.assertRaises(ExifToolUnavailableError):
                ExifToolEngine().check_available()

    def test_run_on_blob_uses_temporary_file_and_returns_modified_bytes(self) -> None:
        calls: list[list[str]] = []
        temp_path: Path | None = None

        def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            nonlocal temp_path
            calls.append(command)
            self.assertIs(kwargs["shell"], False)
            if command == ["exiftool", "-ver"]:
                return subprocess.CompletedProcess(command, 0, stdout="12.76\n", stderr="")

            temp_path = Path(command[-1])
            self.assertEqual(command[:-1], ["exiftool", "-overwrite_original", "-Artist=Tester"])
            self.assertEqual(temp_path.read_bytes(), b"original image bytes")
            temp_path.write_bytes(b"modified image bytes")
            return subprocess.CompletedProcess(command, 0, stdout="1 image files updated\n", stderr="")

        with patch("image_randomizer.core.exiftool_engine.subprocess.run", fake_run):
            result = ExifToolEngine().run_on_blob(
                b"original image bytes",
                ["-overwrite_original", "-Artist=Tester"],
                suffix=".jpg",
            )

        self.assertEqual(result.data, b"modified image bytes")
        self.assertEqual(calls[0], ["exiftool", "-ver"])
        self.assertEqual(calls[1][:-1], ["exiftool", "-overwrite_original", "-Artist=Tester"])
        self.assertEqual(Path(calls[1][-1]).suffix, ".jpg")
        self.assertIsNotNone(temp_path)
        self.assertFalse(temp_path.exists())

    def test_run_on_blob_rejects_shell_command_string(self) -> None:
        with patch("image_randomizer.core.exiftool_engine.subprocess.run") as run:
            with self.assertRaises(TypeError):
                ExifToolEngine().run_on_blob(b"payload", "-json")  # type: ignore[arg-type]
            run.assert_not_called()

    def test_run_on_blob_raises_command_error_on_nonzero_exit(self) -> None:
        def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            if command == ["exiftool", "-ver"]:
                return subprocess.CompletedProcess(command, 0, stdout="12.76\n", stderr="")
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="bad tag")

        with patch("image_randomizer.core.exiftool_engine.subprocess.run", fake_run):
            with self.assertRaises(ExifToolCommandError) as context:
                ExifToolEngine().run_on_blob(b"payload", ["-BadTag=value"], suffix="png")

        self.assertEqual(context.exception.returncode, 1)
        self.assertIn("bad tag", context.exception.stderr)

    def test_read_json_accepts_explicit_read_args(self) -> None:
        calls: list[list[str]] = []

        def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            calls.append(command)
            if command == ["exiftool", "-ver"]:
                return subprocess.CompletedProcess(command, 0, stdout="12.76\n", stderr="")
            return subprocess.CompletedProcess(command, 0, stdout='[{"File:FileType":"JPEG"}]', stderr="")

        with patch("image_randomizer.core.exiftool_engine.subprocess.run", fake_run):
            payload = ExifToolEngine().read_json(b"payload", ["-json", "-G1", "-a", "-s"])

        self.assertEqual(payload, [{"File:FileType": "JPEG"}])
        self.assertEqual(calls[1][:-1], ["exiftool", "-json", "-G1", "-a", "-s"])


if __name__ == "__main__":
    unittest.main()
