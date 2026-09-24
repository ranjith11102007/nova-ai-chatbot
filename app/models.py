from typing import List

from pydantic import BaseModel, Field

from .config import settings


class ChatMessage(BaseModel):
    """A single message in the conversation."""

    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., max_length=settings.MAX_MESSAGE_LENGTH)
    images: List[str] = Field(default_factory=list, max_length=settings.MAX_IMAGES_PER_MESSAGE)


class DocumentContext(BaseModel):
    """Extracted text from an uploaded document, validated server-side."""

    name: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=1, max_length=20000)


class ChatRequest(BaseModel):
    """The body the frontend sends to POST /api/chat."""

    messages: List[ChatMessage] = Field(
        ..., min_length=1, max_length=settings.MAX_HISTORY_MESSAGES
    )
    document: DocumentContext | None = None
    stream: bool = False


class ChatResponse(BaseModel):
    """The body the backend returns from POST /api/chat."""

    reply: str


class SpeechRequest(BaseModel):
    """Body for POST /api/speech (text -> spoken audio)."""

    text: str = Field(..., min_length=1, max_length=settings.MAX_SPEECH_CHARS)
    voice: str = Field("tara", min_length=1, max_length=50)
    speed: float = Field(1.0, ge=0.5, le=2.0)


class SpeechResponse(BaseModel):
    """Body for GET /api/voices."""

    model: str
    voices: list[str]