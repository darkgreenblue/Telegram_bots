"""Convert NotebookLM audio to a Telegram-ready MP3 before delivery."""

import asyncio
import json
import logging
import math
from pathlib import Path

LOG = logging.getLogger("notebook-podcast.audio")


class AudioConversionError(RuntimeError):
    """The downloaded audio could not be delivered as a valid MP3."""


async def _mp3_duration(path: Path) -> int:
    process = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "stream=codec_name:format=duration",
        "-of", "json", str(path), stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await process.communicate()
    if process.returncode != 0:
        raise AudioConversionError("MP3 validation failed")
    try:
        metadata = json.loads(stdout)
        streams = metadata["streams"]
        duration = float(metadata["format"]["duration"])
        if not any(stream.get("codec_name") == "mp3" for stream in streams):
            raise ValueError("No MP3 audio stream")
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("Invalid audio duration")
    except (KeyError, TypeError, ValueError) as exc:
        raise AudioConversionError("MP3 validation failed") from exc
    return max(1, math.ceil(duration))


async def telegram_mp3(source: Path) -> tuple[Path, int]:
    """Return a validated MP3 and duration; retain source until Telegram confirms delivery."""
    if source.suffix.lower() == ".mp3":
        return source, await _mp3_duration(source)
    target = source.with_suffix(".mp3")
    if target.is_file() and target.stat().st_size:
        try:
            return target, await _mp3_duration(target)
        except AudioConversionError:
            target.unlink(missing_ok=True)

    partial = target.with_name(target.name + ".partial")
    partial.unlink(missing_ok=True)
    LOG.info("audio_conversion_started source=%s source_bytes=%d target_bitrate_kbps=96", source.name, source.stat().st_size)
    try:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-map", "0:a:0", "-vn", "-c:a", "libmp3lame",
            "-b:a", "96k", "-ac", "1", "-f", "mp3", str(partial),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await process.communicate()
        if process.returncode != 0 or not partial.is_file() or not partial.stat().st_size:
            LOG.error("audio_conversion_failed source=%s ffmpeg_code=%s detail=%s", source.name, process.returncode, stderr.decode(errors="replace")[-300:])
            raise AudioConversionError("MP3 conversion failed")
        duration = await _mp3_duration(partial)
        partial.replace(target)
        LOG.info("audio_conversion_completed source=%s mp3_bytes=%d duration_seconds=%d", source.name, target.stat().st_size, duration)
        return target, duration
    finally:
        partial.unlink(missing_ok=True)
