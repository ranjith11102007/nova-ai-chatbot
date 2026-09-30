import json
import logging
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .ai_service import (
    get_assistant_reply,
    list_voices,
    stream_assistant_reply,
    synthesize_speech,
    transcribe_audio,
)
from .config import PROVIDERS, settings, provider_configured
from .models import ChatRequest, ChatResponse, SpeechRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nova_ai")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

ALLOWED_AUDIO_EXTENSIONS = {"webm", "ogg", "wav", "mp3", "m4a", "mp4"}
MAX_AUDIO_BYTES = 10 * 1024 * 1024


class NoCacheStaticFiles(StaticFiles):
    """Static files that always ask the browser to revalidate via ETag,
    so freshly deployed frontend code is never masked by a stale cache."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


app = FastAPI(title="Nova AI Chatbot")

# Serve style.css and script.js from the static folder.
app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    """Serve the main chat page."""
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/voice")
def voice() -> FileResponse:
    """Serve the standalone voice chat page."""
    return FileResponse(STATIC_DIR / "voice.html")


@app.get("/api/health")
def health():
    """Simple health check used to verify the server is running."""
    return {
        "status": "ok",
        "api_key_configured": settings.has_api_key(),
        "model": settings.AI_MODEL if settings.has_model() else "default",
    }


@app.get("/api/models")
def list_models():
    """List available providers/models (marks which keys are configured).

    Never exposes API keys — only a boolean per provider.
    """
    provider_ids = list(PROVIDERS)
    return {
        "default": "groq@" + (settings.AI_MODEL if settings.has_model() else "qwen/qwen3.8-27b"),
        "providers": [
            {
                "id": pid,
                "label": PROVIDERS[pid]["label"],
                "configured": provider_configured(pid),
                "models": PROVIDERS[pid]["models"],
                "labels": PROVIDERS[pid].get("labels", {}),
                "key_env": PROVIDERS[pid]["key_env"],
                "custom": PROVIDERS[pid]["custom"],
            }
            for pid in provider_ids
        ],
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    """Receive the conversation, get Nova's reply, and return it."""
    messages = _clamp_chat_messages(request)

    logger.info("Received %d message(s) from the user.", len(messages))

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

    try:
        reply = get_assistant_reply(messages, language=request.language, model=request.model)
    except RuntimeError as exc:
        logger.error("Chat request failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    logger.info("Nova replied successfully.")
    return ChatResponse(reply=reply)


def _clamp_chat_messages(request: ChatRequest) -> list[dict]:
    """Normalize the conversation before it reaches the model:
    clamp content length and keep only the most recent messages."""
    messages = [m.model_dump() for m in request.messages]
    return [
        {"role": m["role"], "content": m["content"][: settings.MAX_MESSAGE_LENGTH]}
        for m in messages
    ][-settings.MAX_HISTORY_MESSAGES:]


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """Stream Nova's reply tokens as server-sent events (used by voice chat)."""
    messages = _clamp_chat_messages(request)
    logger.info("Streaming a reply for %d message(s).", len(messages))

    def event_source():
        try:
            for token in stream_assistant_reply(
                messages, language=request.language, model=request.model
            ):
                yield "data: " + json.dumps({"token": token}, ensure_ascii=False) + "\n\n"
        except RuntimeError as exc:
            logger.error("Stream failed: %s", exc)
            yield "data: " + json.dumps({"error": str(exc)}, ensure_ascii=False) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """Transcribe an uploaded audio clip with Groq Whisper."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Could not read the audio file.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=400,
            detail="This audio is too large. Please keep clips under 10 MB.",
        )

    filename = file.filename or "audio.webm"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_type = file.content_type or ""
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
    """Return spoken audio (wav) for the given text via Groq TTS."""
    try:
        audio = synthesize_speech(request.text, request.voice, request.speed)
    except RuntimeError as exc:
        logger.error("Speech synthesis failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(content=audio, media_type="audio/wav")


@app.get("/api/voices")
def voices():
    """Return the supported TTS voices."""
    return list_voices()
