import base64
import json
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .ai_service import (
    get_assistant_reply,
    stream_assistant_reply,
    list_voices,
    synthesize_speech,
    transcribe_audio,
)
from .config import settings
from .document_service import extract_text
from .models import ChatRequest, ChatResponse, SpeechRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nova_ai")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Nova AI Chatbot")

# Serve style.css and script.js from the static folder.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

ALLOWED_IMAGE_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}
ALLOWED_AUDIO_EXTENSIONS = {"webm", "ogg", "wav", "mp3", "m4a", "mp4"}


@app.get("/")
def index() -> FileResponse:
    """Serve the main chat page."""
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    """Simple health check used to verify the server is running."""
    return {
        "status": "ok",
        "api_key_configured": settings.has_api_key(),
        "model": settings.AI_MODEL if settings.has_model() else "default",
    }


def _validate_image_uri(uri: str) -> str:
    """Validate an image data URI and return the allowed MIME type or 400."""
    if not uri.startswith("data:") or ";base64," not in uri:
        raise HTTPException(status_code=400, detail="This image is invalid.")
    header, payload = uri.split(";base64,", 1)
    mime = header[len("data:"):].strip().lower()
    if mime not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="This file type isn't supported.")
    try:
        raw = base64.b64decode(payload, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="This image is invalid.") from None
    if len(raw) > settings.MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400, detail="This image is too large. Please choose a smaller image."
        )
    return mime


def _to_message_dicts(request: ChatRequest) -> list[dict]:
    """Convert validated messages, dropping images from non-user roles."""
    for message in request.messages:
        if message.images:
            if message.role != "user":
                message.images.clear()
            for uri in message.images:
                _validate_image_uri(uri)
    return [
        {
            "role": m.role,
            "content": m.content,
            "images": m.images,
        }
        for m in request.messages
    ]


def _require_provider() -> None:
    if not settings.has_api_key():
        raise HTTPException(
            status_code=500,
            detail="The server is missing AI_API_KEY. Copy .env.example to .env "
            "and add your API key, then restart the server.",
        )
    if not settings.has_model():
        raise HTTPException(
            status_code=500,
            detail="The server is missing AI_MODEL. Set it in your .env file "
            "(for example AI_MODEL=gpt-4o-mini), then restart the server.",
        )


def _sse(payload: dict) -> str:
    return "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"


@app.post("/api/chat")
def chat(request: ChatRequest):
    """Receive the conversation, get Nova's reply, and return it.

    Supports streaming (SSE) via `stream: true` and multimodal messages that
    carry base64 image data URIs plus an optional extracted document context.
    """
    _require_provider()

    message_dicts = _to_message_dicts(request)
    messages = message_dicts[-settings.MAX_HISTORY_MESSAGES:]
    document = (
        {
            "name": request.document.name,
            "text": request.document.text[: settings.MAX_DOCUMENT_CHARS],
        }
        if request.document
        else None
    )

    logger.info("Received %d message(s) from the user.", len(messages))

    if request.stream:
        def event_stream():
            try:
                empty = True
                for delta in stream_assistant_reply(messages, document):
                    empty = False
                    yield _sse({"delta": delta})
                if empty:
                    yield _sse(
                        {"delta": "I am sorry, I could not generate a reply. Please try again."}
                    )
                yield _sse({"done": True})
            except RuntimeError as exc:
                logger.error("Streaming chat failed: %s", exc)
                yield _sse({"error": str(exc)})
                yield _sse({"done": True})

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    try:
        reply = get_assistant_reply(messages, document)
    except RuntimeError as exc:
        logger.error("Chat request failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    logger.info("Nova replied successfully.")
    return ChatResponse(reply=reply)


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """Transcribe an uploaded audio clip with Groq Whisper."""
    try:
        data = await file.read((settings.MAX_UPLOAD_MB * 1024 * 1024) + 1)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the audio file.") from None

    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="This audio is too large. Please keep clips under "
            f"{settings.MAX_UPLOAD_MB} MB.",
        )

    filename = file.filename or "audio.webm"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_type = (file.content_type or "").lower()

    if not (content_type.startswith("audio/") or ext in ALLOWED_AUDIO_EXTENSIONS):
        raise HTTPException(status_code=400, detail="This audio format isn't supported.")

    try:
        text = transcribe_audio(data, filename)
    except RuntimeError as exc:
        logger.error("Transcription failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"text": text}


@app.post("/api/speech")
def speech(request: SpeechRequest):
    """Return spoken audio (mp3) for the given text via Groq Orpheus TTS."""
    try:
        audio = synthesize_speech(request.text, request.voice, request.speed)
    except RuntimeError as exc:
        logger.error("Speech synthesis failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(content=audio, media_type="audio/mpeg")


@app.get("/api/voices")
def voices():
    """Return the supported TTS voices."""
    return list_voices()


@app.post("/api/document")
async def document(file: UploadFile = File(...)):
    """Validate, extract, and return the readable text of a document."""
    try:
        data = await file.read((settings.MAX_UPLOAD_MB * 1024 * 1024) + 1)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the file.") from None

    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="This file is too large. Please choose a smaller file.",
        )

    filename = file.filename or "document.txt"
    content_type = (file.content_type or "").lower()
    try:
        text = extract_text(filename, content_type, data)
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"name": filename, "text": text}