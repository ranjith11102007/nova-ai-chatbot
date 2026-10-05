from typing import List

from pydantic import BaseModel, Field

from .config import settings


class ChatMessage(BaseModel):
    """A single message in the conversation."""

    role: str = Field(..., pattern="^(user|assistant|system)$")
    # Generous hard ceiling so an over-long stored reply never 422s the API;
    # chat() clamps content down to MAX_MESSAGE_LENGTH before the model call.
    content: str = Field(..., max_length=100000)


class DocumentPart(BaseModel):
    """A document the user attached, already extracted to plain text."""

    name: str = Field("", max_length=200)
    text: str = Field("", max_length=400000)


class ChatRequest(BaseModel):
    """The body the frontend sends to POST /api/chat."""

    messages: List[ChatMessage] = Field(
        ..., min_length=1, max_length=settings.MAX_HISTORY_MESSAGES
    )
    language: str = Field(
        "", max_length=60, description="Preferred reply language (empty = default)."
    )
    model: str = Field(
        "",
        max_length=120,
        description="Model selector as provider@model-id (empty = server default).",
    )
    # Attachments travel beside the (text-only) messages so history, titles and
    # clamping stay exactly as they were.
    images: List[str] = Field(
        default_factory=list,
        max_length=8,
        description="Attached images as data URLs.",
    )
    documents: List[DocumentPart] = Field(
        default_factory=list,
        max_length=8,
        description="Attached documents as already-extracted text.",
    )


class ChatResponse(BaseModel):
    """The body the backend returns from POST /api/chat."""

    reply: str
    note: str = Field(
        "", description="Optional heads-up, e.g. when a vision model was used."
    )


class ImageRequest(BaseModel):
    """The body for POST /api/image (text -> generated image)."""

    prompt: str = Field(..., min_length=1, max_length=1000)
    model: str = Field("", max_length=120)


class ImageResponse(BaseModel):
    """The body the backend returns from POST /api/image."""

    image: str = Field(..., description="Generated image as a data URL.")
    model: str = ""


class DocumentResponse(BaseModel):
    """The body the backend returns from POST /api/document (file -> text)."""

    name: str = ""
    text: str = ""


class SpeechRequest(BaseModel):
    """Body for POST /api/speech (text -> spoken audio)."""

    text: str = Field(..., min_length=1, max_length=settings.MAX_SPEECH_CHARS)
    voice: str = Field("autumn", min_length=1, max_length=50)
    speed: float = Field(1.0, ge=0.5, le=2.0)


class SpeechResponse(BaseModel):
    """Body for GET /api/voices."""

    model: str
    voices: list[str]