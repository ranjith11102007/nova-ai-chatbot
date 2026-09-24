import io
import logging
from typing import Generator, Iterator

from openai import OpenAI
from openai import (
    APIError,
    APIConnectionError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
)

from .config import settings

logger = logging.getLogger("nova_ai")

# Instructions that define Nova's behaviour and personality.
SYSTEM_PROMPT = (
    "You are Nova, a helpful, friendly, and reliable AI assistant. "
    "Answer clearly and accurately. If you are unsure, say that you are unsure. "
    "Do not invent facts. Keep answers reasonably concise unless the user asks "
    "for detailed instructions. Help the user learn programming, AI, Python, "
    "JavaScript, and web development."
)

# Voices supported by the configured TTS model (canopylabs/orpheus).
VOICES = [
    "tara",
    "leah",
    "jess",
    "leo",
    "dan",
    "mia",
    "zoe",
    "aria",
    "kai",
    "ella",
]


def get_client() -> OpenAI:
    """Build an OpenAI client for the configured provider."""
    return OpenAI(
        api_key=settings.AI_API_KEY,
        base_url=settings.openai_base_url,
    )


def _build_openai_messages(
    messages: list[dict], document: dict | None = None
) -> list[dict]:
    """Turn validated chat messages into the OpenAI-compatible message list.

    Images (data URIs) are embedded as image_url parts so the model can see
    them; an extracted document is added as a separate system context block.
    """
    out: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    if document:
        out.append(
            {
                "role": "system",
                "content": (
                    'The user attached a document named "%(name)s". '
                    "Use its content to answer when it is relevant to their "
                    "question, even when the question does not mention the file. "
                    "If the document does not contain the answer, say so."
                    "\n\n--- DOCUMENT START ---\n"
                    "%(text)s"
                    "\n--- DOCUMENT END ---"
                )
                % {"name": document["name"], "text": document["text"]},
            }
        )

    for m in messages:
        images = m.get("images") or []
        role = m["role"]
        if images and role == "user":
            content: list[dict] = [
                {
                    "type": "text",
                    "text": m["content"]
                    or "What can you tell me about this image?",
                }
            ]
            for uri in images[: settings.MAX_IMAGES_PER_MESSAGE]:
                content.append({"type": "image_url", "image_url": {"url": uri}})
            out.append({"role": "user", "content": content})
        else:
            out.append({"role": role, "content": m["content"]})
    return out


def _friendly_api_error(exc: Exception) -> RuntimeError:
    """Map provider exceptions to safe, user-facing messages."""
    if isinstance(exc, AuthenticationError):
        logger.error("Invalid API key for the AI provider.")
        return RuntimeError(
            "Authentication failed: your API key is invalid or expired. "
            "Check AI_API_KEY in your .env file."
        )
    if isinstance(exc, RateLimitError):
        logger.error("Rate limit hit for the AI provider.")
        return RuntimeError("Rate limit reached. Wait a moment and try again.")
    if isinstance(exc, APIConnectionError):
        logger.error("Could not reach the AI provider.")
        return RuntimeError(
            "Could not reach the AI service. Check your internet connection "
            "and that AI_BASE_URL is correct."
        )
    if isinstance(exc, APIError):
        logger.error("AI provider API error: %s", exc)
        return RuntimeError(
            "The AI service returned an error (status %s). "
            "Check your AI_BASE_URL and AI_MODEL." % exc.status_code
        )
    logger.exception("Unexpected error while talking to the AI provider.")
    return RuntimeError(
        "An unexpected error happened while talking to the AI service."
    )


def get_assistant_reply(
    messages: list[dict], document: dict | None = None
) -> str:
    """Add the system prompt, call the model, and return Nova's full reply."""
    if not settings.has_api_key():
        raise RuntimeError("AI_API_KEY is missing from your .env file.")

    model = settings.AI_MODEL or "gpt-4o-mini"
    full_messages = _build_openai_messages(messages, document)

    try:
        client = get_client()
        response = client.chat.completions.create(
            model=model,
            messages=full_messages,
            temperature=0.7,
        )
        reply = response.choices[0].message.content
    except Exception as exc:
        raise _friendly_api_error(exc) from None

    if not reply or not reply.strip():
        return "I am sorry, I could not generate a reply. Please try again."
    return reply.strip()


def stream_assistant_reply(
    messages: list[dict], document: dict | None = None
) -> Generator[str, None, None]:
    """Stream Nova's reply token by token (SSE from the route)."""
    if not settings.has_api_key():
        raise RuntimeError("AI_API_KEY is missing from your .env file.")

    model = settings.AI_MODEL or "gpt-4o-mini"
    full_messages = _build_openai_messages(messages, document)

    try:
        client = get_client()
        stream: Iterator = client.chat.completions.create(
            model=model,
            messages=full_messages,
            temperature=0.7,
            stream=True,
        )
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except Exception as exc:
        raise _friendly_api_error(exc) from None


def transcribe_audio(data: bytes, filename: str) -> str:
    """Transcribe recorded audio to text with Groq Whisper."""
    if not settings.has_api_key():
        raise RuntimeError("AI_API_KEY is missing from your .env file.")

    client = get_client()
    try:
        buf = io.BytesIO(data)
        buf.name = filename
        result = client.audio.transcriptions.create(
            model=settings.AI_STT_MODEL,
            file=buf,
            response_format="json",
        )
        text = (result.text or "").strip()
        if not text:
            raise RuntimeError("I could not hear any speech. Please try again.")
        return text
    except RuntimeError:
        raise
    except BadRequestError as exc:
        logger.error("Transcription rejected: %s", exc)
        raise RuntimeError(
            "Sorry, I could not process that audio. Please try again."
        ) from None
    except Exception as exc:
        raise _friendly_api_error(exc) from None


def synthesize_speech(text: str, voice: str, speed: float = 1.0) -> bytes:
    """Turn text into spoken audio bytes (mp3) with Groq Orpheus TTS."""
    if not settings.has_api_key():
        raise RuntimeError("AI_API_KEY is missing from your .env file.")

    client = get_client()
    try:
        response = client.audio.speech.create(
            model=settings.AI_TTS_MODEL,
            voice=voice,
            input=text,
            speed=speed,
        )
        return response.content
    except BadRequestError as exc:
        message = str(exc)
        if "terms" in message.lower():
            logger.warning("TTS model terms not accepted yet: %s", exc)
            raise RuntimeError(
                "Spoken replies aren't enabled yet — the TTS model's terms need "
                "to be accepted in the Groq console (see README)."
            ) from None
        logger.error("Speech synthesis rejected: %s", exc)
        raise RuntimeError(
            "Sorry, I could not generate the audio for that voice."
        ) from None
    except Exception as exc:
        raise _friendly_api_error(exc) from None


def list_voices() -> dict:
    """Return the supported TTS voices for the configured model."""
    return {"model": settings.AI_TTS_MODEL, "voices": VOICES}