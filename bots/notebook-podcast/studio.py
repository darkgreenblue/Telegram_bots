"""NotebookLM Studio output choices and resumable downloads."""

import json
from pathlib import Path
from urllib.parse import urlparse, urlunparse, parse_qsl

from notebooklm import (
    AudioFormat, AudioLength, InfographicDetail, InfographicOrientation,
    InfographicStyle, NotebookLMClient, QuizDifficulty, QuizQuantity,
    ReportFormat, SlideDeckFormat, SlideDeckLength, VideoFormat, VideoStyle,
)

KINDS = [
    ("audio", "🎙 پادکست"), ("video", "🎬 ویدیو"),
    ("cinematic", "🎞 ویدیوی سینمایی"), ("slides", "📊 اسلاید"),
    ("infographic", "🖼 اینفوگرافیک"), ("report", "📝 گزارش"),
    ("table", "📋 جدول داده"), ("quiz", "❓ آزمون"),
    ("flashcards", "🗂 فلش‌کارت"), ("mindmap", "🕸 نقشهٔ ذهنی"),
]
KIND_LABELS = dict(KINDS)

# key, question, button choices. All choices are sent through NotebookLM-py.
STEPS = {
    "audio": [
        ("audio_format", "قالب گفت‌وگو", [("عمیق", "deep-dive"), ("خلاصه", "brief"), ("نقد", "critique"), ("مناظره", "debate")]),
        ("audio_length", "طول پادکست", [("کوتاه", "short"), ("معمولی", "default"), ("بلند", "long")]),
    ],
    "video": [
        ("video_format", "قالب ویدیو", [("توضیحی", "explainer"), ("خلاصه", "brief"), ("کوتاه", "short")]),
        ("video_style", "سبک ویدیو", [("خودکار", "auto"), ("کلاسیک", "classic"), ("وایت‌برد", "whiteboard"), ("انیمه", "anime"), ("آبرنگ", "watercolor"), ("چاپ قدیمی", "retro"), ("میراثی", "heritage"), ("کاغذی", "paper"), ("کاوایی", "kawaii")]),
    ],
    "cinematic": [],
    "slides": [
        ("slide_format", "نوع اسلاید", [("کامل", "detailed"), ("ارائه", "presenter")]),
        ("slide_length", "طول اسلاید", [("معمولی", "default"), ("کوتاه", "short")]),
        ("file_format", "فایل خروجی", [("PDF", "pdf"), ("PowerPoint", "pptx")]),
    ],
    "infographic": [
        ("orientation", "جهت تصویر", [("افقی", "landscape"), ("عمودی", "portrait"), ("مربع", "square")]),
        ("detail", "میزان جزئیات", [("کم", "concise"), ("معمولی", "standard"), ("زیاد", "detailed")]),
        ("infographic_style", "سبک تصویر", [("خودکار", "auto"), ("حرفه‌ای", "professional"), ("یادداشت تصویری", "sketch"), ("بنتو", "bento"), ("مجله‌ای", "editorial"), ("آموزشی", "instructional"), ("آجر", "bricks"), ("خمیری", "clay"), ("انیمه", "anime"), ("کاوایی", "kawaii"), ("علمی", "scientific")]),
    ],
    "report": [
        ("report_format", "نوع گزارش", [("خلاصهٔ تحلیلی", "briefing"), ("راهنمای مطالعه", "study"), ("پست وبلاگ", "blog"), ("توضیح مفهوم", "concept"), ("سفارشی", "custom")]),
    ],
    "table": [],
    "quiz": [
        ("quantity", "تعداد سؤال", [("کم", "fewer"), ("معمولی", "standard"), ("زیاد", "more")]),
        ("difficulty", "سختی", [("آسان", "easy"), ("متوسط", "medium"), ("سخت", "hard")]),
        ("file_format", "فایل خروجی", [("متن Markdown", "markdown"), ("JSON", "json"), ("HTML", "html")]),
    ],
    "flashcards": [
        ("quantity", "تعداد کارت", [("کم", "fewer"), ("معمولی", "standard"), ("زیاد", "more")]),
        ("difficulty", "سختی", [("آسان", "easy"), ("متوسط", "medium"), ("سخت", "hard")]),
        ("file_format", "فایل خروجی", [("متن Markdown", "markdown"), ("JSON", "json"), ("HTML", "html")]),
    ],
    "mindmap": [],
}


def output_path(session: dict) -> Path:
    kind = session["output_type"]
    settings = session.get("settings", {})
    extension = {
        "audio": "m4a", "video": "mp4", "cinematic": "mp4", "slides": settings.get("file_format", "pdf"),
        "infographic": "png", "report": "md", "table": "csv",
        "quiz": settings.get("file_format", "markdown").replace("markdown", "md"),
        "flashcards": settings.get("file_format", "markdown").replace("markdown", "md"),
        "mindmap": "json",
    }[kind]
    return Path(session["work_dir"]) / f"{session['batch_id']}.{extension}"


def bind_asset_download_to_account(client) -> None:
    """Keep Google file downloads on the account used for NotebookLM RPCs.

    The pinned NotebookLM client omits authuser on Google usercontent URLs.
    With multiple signed-in Google accounts, that sends a valid artifact to
    account 0 and Google responds with 403 even though account 3 created it.
    """
    authuser = client.get_account_authuser()
    transfer = client.artifacts._downloads
    original = transfer._download_to_path

    async def download_for_account(url: str, path: str) -> str:
        parsed = urlparse(url)
        if parsed.hostname in {"contribution.usercontent.google.com", "lh3.googleusercontent.com"}:
            if "authuser" not in {key for key, _ in parse_qsl(parsed.query)}:
                query = f"{parsed.query}&authuser={authuser}" if parsed.query else f"authuser={authuser}"
                url = urlunparse(parsed._replace(query=query))
        return await original(url, path)

    transfer._download_to_path = download_for_account


async def generate_artifact(session: dict, save, profile: str) -> Path:
    """Generate once, persist the task ID, and download the exact artifact."""
    kind = session["output_type"]
    settings = session.get("settings", {})
    output = output_path(session)
    if output.exists() and output.stat().st_size:
        return output
    source_ids = session.get("source_ids") or [i["source_id"] for i in session["inputs"] if i.get("source_id")]
    if not source_ids:
        raise ValueError("Notebook has no uploaded sources")
    notebook_id = session["notebook_id"]
    language = session.get("language", "en")
    prompt = session.get("prompt") or ""
    output.parent.mkdir(parents=True, exist_ok=True)
    async with NotebookLMClient.from_storage(profile=profile) as client:
        bind_asset_download_to_account(client)
        if kind == "mindmap":
            if not session.get("note_id"):
                result = await client.artifacts.generate_mind_map(notebook_id, source_ids=source_ids, language=language, instructions=prompt)
                session["note_id"] = result.note_id
                save(session)
                if result.mind_map is not None:
                    partial = output.with_suffix(".json.download")
                    partial.write_text(json.dumps(result.mind_map, ensure_ascii=False, indent=2))
                    partial.replace(output)
                    return output
                if not result.note_id:
                    raise RuntimeError("NotebookLM did not return a mind map or note ID")
            await client.artifacts.download_mind_map(notebook_id, str(output), artifact_id=session["note_id"])
            return output

        if not session.get("task_id"):
            if kind == "audio":
                status = await client.artifacts.generate_audio(
                    notebook_id, source_ids=source_ids, language=language, instructions=prompt,
                    audio_format={"deep-dive": AudioFormat.DEEP_DIVE, "brief": AudioFormat.BRIEF, "critique": AudioFormat.CRITIQUE, "debate": AudioFormat.DEBATE}[settings.get("audio_format", "deep-dive")],
                    audio_length={"short": AudioLength.SHORT, "default": AudioLength.DEFAULT, "long": AudioLength.LONG}[settings.get("audio_length", "default")],
                )
            elif kind == "video":
                status = await client.artifacts.generate_video(
                    notebook_id, source_ids=source_ids, language=language, instructions=prompt,
                    video_format={"explainer": VideoFormat.EXPLAINER, "brief": VideoFormat.BRIEF, "short": VideoFormat.SHORT}[settings.get("video_format", "explainer")],
                    video_style={"auto": VideoStyle.AUTO_SELECT, "classic": VideoStyle.CLASSIC, "whiteboard": VideoStyle.WHITEBOARD, "anime": VideoStyle.ANIME, "watercolor": VideoStyle.WATERCOLOR, "retro": VideoStyle.RETRO_PRINT, "heritage": VideoStyle.HERITAGE, "paper": VideoStyle.PAPER_CRAFT, "kawaii": VideoStyle.KAWAII}[settings.get("video_style", "auto")],
                )
            elif kind == "cinematic":
                status = await client.artifacts.generate_cinematic_video(notebook_id, source_ids=source_ids, language=language, instructions=prompt)
            elif kind == "slides":
                status = await client.artifacts.generate_slide_deck(
                    notebook_id, source_ids=source_ids, language=language, instructions=prompt,
                    slide_format={"detailed": SlideDeckFormat.DETAILED_DECK, "presenter": SlideDeckFormat.PRESENTER_SLIDES}[settings.get("slide_format", "detailed")],
                    slide_length={"default": SlideDeckLength.DEFAULT, "short": SlideDeckLength.SHORT}[settings.get("slide_length", "default")],
                )
            elif kind == "infographic":
                status = await client.artifacts.generate_infographic(
                    notebook_id, source_ids=source_ids, language=language, instructions=prompt,
                    orientation={"landscape": InfographicOrientation.LANDSCAPE, "portrait": InfographicOrientation.PORTRAIT, "square": InfographicOrientation.SQUARE}[settings.get("orientation", "landscape")],
                    detail_level={"concise": InfographicDetail.CONCISE, "standard": InfographicDetail.STANDARD, "detailed": InfographicDetail.DETAILED}[settings.get("detail", "standard")],
                    style={"auto": InfographicStyle.AUTO_SELECT, "professional": InfographicStyle.PROFESSIONAL, "sketch": InfographicStyle.SKETCH_NOTE, "bento": InfographicStyle.BENTO_GRID, "editorial": InfographicStyle.EDITORIAL, "instructional": InfographicStyle.INSTRUCTIONAL, "bricks": InfographicStyle.BRICKS, "clay": InfographicStyle.CLAY, "anime": InfographicStyle.ANIME, "kawaii": InfographicStyle.KAWAII, "scientific": InfographicStyle.SCIENTIFIC}[settings.get("infographic_style", "auto")],
                )
            elif kind == "report":
                report_format = {"briefing": ReportFormat.BRIEFING_DOC, "study": ReportFormat.STUDY_GUIDE, "blog": ReportFormat.BLOG_POST, "concept": ReportFormat.CONCEPT_EXPLANATION, "custom": ReportFormat.CUSTOM}[settings.get("report_format", "briefing")]
                status = await client.artifacts.generate_report(
                    notebook_id, report_format=report_format, source_ids=source_ids, language=language,
                    custom_prompt=prompt if report_format is ReportFormat.CUSTOM else None,
                    extra_instructions=prompt if report_format is not ReportFormat.CUSTOM else None,
                )
            elif kind == "table":
                status = await client.artifacts.generate_data_table(notebook_id, source_ids=source_ids, language=language, instructions=prompt)
            elif kind in {"quiz", "flashcards"}:
                method = client.artifacts.generate_quiz if kind == "quiz" else client.artifacts.generate_flashcards
                status = await method(
                    notebook_id, source_ids=source_ids,
                    instructions=f"Output language: {language}. {prompt}".strip(),
                    quantity={"fewer": QuizQuantity.FEWER, "standard": QuizQuantity.STANDARD, "more": QuizQuantity.MORE}[settings.get("quantity", "standard")],
                    difficulty={"easy": QuizDifficulty.EASY, "medium": QuizDifficulty.MEDIUM, "hard": QuizDifficulty.HARD}[settings.get("difficulty", "medium")],
                )
            else:
                raise ValueError("Unsupported Studio output type")
            session["task_id"] = status.task_id
            save(session)

        result = await client.artifacts.wait_for_completion(notebook_id, session["task_id"], timeout=1800, initial_interval=5)
        if not result.is_complete:
            raise RuntimeError(f"NotebookLM generation ended with {result.status}")
        partial = output.with_suffix(output.suffix + ".download")
        partial.unlink(missing_ok=True)
        method = getattr(client.artifacts, {
            "audio": "download_audio", "video": "download_video", "cinematic": "download_video",
            "slides": "download_slide_deck", "infographic": "download_infographic",
            "report": "download_report", "table": "download_data_table",
            "quiz": "download_quiz", "flashcards": "download_flashcards",
        }[kind])
        kwargs = {"artifact_id": session["task_id"]}
        if kind in {"slides", "quiz", "flashcards"}:
            kwargs["output_format"] = settings.get("file_format", "pdf" if kind == "slides" else "markdown")
        await method(notebook_id, str(partial), **kwargs)
        partial.replace(output)
        return output
