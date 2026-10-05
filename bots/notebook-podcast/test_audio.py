"""Real codec checks for the audio delivery boundary."""

import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path

from audio import telegram_mp3


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg is required")
class AudioConversionTests(unittest.IsolatedAsyncioTestCase):
    async def test_m4a_becomes_reusable_mp3_without_removing_original(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "lesson.m4a"
            process = await asyncio.create_subprocess_exec(
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                "-c:a", "aac", str(source),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await process.communicate()
            self.assertEqual(process.returncode, 0, stderr.decode(errors="replace"))

            mp3, duration = await telegram_mp3(source)
            self.assertEqual(mp3.suffix, ".mp3")
            self.assertTrue(source.is_file())
            self.assertGreater(mp3.stat().st_size, 0)
            self.assertGreaterEqual(duration, 2)
            first_modified = mp3.stat().st_mtime_ns

            same_mp3, same_duration = await telegram_mp3(source)
            self.assertEqual((same_mp3, same_duration), (mp3, duration))
            self.assertEqual(mp3.stat().st_mtime_ns, first_modified)
            self.assertFalse(mp3.with_name(mp3.name + ".partial").exists())

    async def test_failed_conversion_keeps_source_and_removes_partial_file(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "broken.m4a"
            source.write_bytes(b"not audio")
            with self.assertRaises(RuntimeError):
                await telegram_mp3(source)
            self.assertEqual(source.read_bytes(), b"not audio")
            self.assertFalse(source.with_suffix(".mp3").exists())
            self.assertFalse((Path(directory) / "broken.mp3.partial").exists())


if __name__ == "__main__":
    unittest.main()
