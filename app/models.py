from typing import List

from pydantic import BaseModel, Field

from .config import settings


class ChatMessage(BaseModel):
    """A single message in the conversation."""

    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., max_length=settings.MAX_MESSAGE_LENGTH)


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


class ChatResponse(BaseModel):
    """The body the backend returns from POST /api/chat."""

    reply: str