import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .ai_service import get_assistant_reply
from .config import PROVIDERS, settings, provider_configured
from .models import ChatRequest, ChatResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nova_ai")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


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
    messages = [m.model_dump() for m in request.messages]

    # Keep only the most recent messages to stay within model limits.
    messages = messages[-settings.MAX_HISTORY_MESSAGES:]

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
