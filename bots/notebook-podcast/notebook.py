"""NotebookLM work for one durable Telegram batch."""

import asyncio
import logging
from pathlib import Path

from notebooklm import AudioFormat, AudioLength, ClientError, NetworkError, NotebookLMClient, ServerError

LOG = logging.getLogger(__name__)
FORMATS = {
    "deep-dive": AudioFormat.DEEP_DIVE,
    "brief": AudioFormat.BRIEF,
    "critique": AudioFormat.CRITIQUE,
    "debate": AudioFormat.DEBATE,
}
LENGTHS = {
    "short": AudioLength.SHORT,
    "default": AudioLength.DEFAULT,
    "long": AudioLength.LONG,
}


class InputValidationError(ValueError):
    """A source problem safe to describe to the user."""


def _retryable_upload_error(exc: Exception, session: dict) -> bool:
    if isinstance(exc, InputValidationError):
        return False
    if isinstance(exc, (NetworkError, ServerError)):
        return True
    if isinstance(exc, ClientError):
        return not session.get("notebook_id")
    return isinstance(exc, ValueError) and "Final URL: https://notebook.google/" in str(exc)


async def upload(session: dict, save, download_file, profile: str, on_retry=None) -> None:
    """Upload every source in order; retain progress for retry after a restart."""
    for attempt in range(5):
        try:
            await _upload_once(session, save, download_file, profile)
            return
        except Exception as exc:
            if attempt == 4 or not _retryable_upload_error(exc, session):
                raise
            LOG.warning("NotebookLM upload retry %s after %s", attempt + 1, type(exc).__name__)
            if on_retry is not None:
                await on_retry()
            await asyncio.sleep(2 ** attempt)


async def _upload_once(session: dict, save, download_file, profile: str) -> None:
    async with NotebookLMClient.from_storage(profile=profile) as client:
        if not session.get("notebook_id"):
            # A stable title lets us recover a create that succeeded just before a crash.
            title = session.get("create_title", session["notebook_title"])
            existing = next((n for n in await client.notebooks.list() if n.title == title), None)
            nb = existing or await client.notebooks.create(title)
            session["notebook_id"] = nb.id
            save(session)
        nb_id = session["notebook_id"]
        if session.get("create_title") and not session.get("renamed"):
            await client.notebooks.rename(nb_id, session["notebook_title"])
            session["renamed"] = True
            save(session)

        for index, item in enumerate(session["inputs"]):
            if item.get("source_id"):
                continue
            if item.get("error"):
                raise InputValidationError(f"ورودی {index + 1}: {item['error']}")
            if item["kind"] == "url":
                known = next(
                    (s for s in await client.sources.list(nb_id) if s.url == item["value"]), None
                )
                source = known or await client.sources.add_url(nb_id, item["value"], wait=True)
            elif item["kind"] == "text":
                title = f"Telegram text {session['batch_id'][:8]}-{index + 1}"
                known = next(
                    (s for s in await client.sources.list(nb_id) if s.title == title), None
                )
                source = known or await client.sources.add_text(
                    nb_id, title, item["value"], wait=True
                )
            else:
                filename = f"{session['batch_id'][:8]}-{index + 1}-{item['filename']}"
                target = Path(session["work_dir"]) / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    await download_file(item["file_id"], target)
                source = await client.sources.add_file(nb_id, target, wait=True)
                target.unlink(missing_ok=True)
            session["inputs"][index]["source_id"] = source.id
            save(session)


async def generate(session: dict, save, profile: str) -> Path:
    """Create once, resume by task ID, then download that exact audio artifact."""
    async with NotebookLMClient.from_storage(profile=profile) as client:
        if not session.get("task_id"):
            status = await client.artifacts.generate_audio(
                session["notebook_id"],
                source_ids=[item["source_id"] for item in session["inputs"]],
                instructions=session.get("prompt") or "",
                audio_format=FORMATS[session["format"]],
                audio_length=LENGTHS[session["length"]],
                language=session["language"],
            )
            session["task_id"] = status.task_id
            save(session)
        result = await client.artifacts.wait_for_completion(
            session["notebook_id"], session["task_id"], timeout=1200, initial_interval=5
        )
        if not result.is_complete:
            raise RuntimeError(f"NotebookLM generation ended with {result.status}")
        output = Path(session["work_dir"]) / f"{session['batch_id']}.m4a"
        output.parent.mkdir(parents=True, exist_ok=True)
        if not output.exists():
            partial = output.with_suffix(".download")
            partial.unlink(missing_ok=True)
            await client.artifacts.download_audio(
                session["notebook_id"], str(partial), artifact_id=session["task_id"]
            )
            partial.replace(output)
        return output
