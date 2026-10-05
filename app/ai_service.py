import base64
import io
import logging
import re
from collections.abc import Iterator

from openai import OpenAI
from openai import APIError, APIConnectionError, AuthenticationError
from openai import RateLimitError

from .config import (
    PROVIDERS,
    settings,
    provider_base_url,
    provider_config,
    provider_configured,
    provider_key,
)

logger = logging.getLogger("nova_ai")

# Instructions that define Nova's behaviour and personality.
SYSTEM_PROMPT = (
    "You are Nova, a helpful, friendly, and reliable AI assistant. "
    "Answer clearly and accurately. If you are unsure, say that you are unsure. "
    "Do not invent facts. Keep answers reasonably concise unless the user asks "
    "for detailed instructions. Help the user learn programming, AI, Python, "
    "JavaScript, and web development."
)

# One cached OpenAI client per provider.
_clients: dict[str, OpenAI] = {}


def get_client() -> OpenAI:
    """Build an OpenAI client for the configured default provider (Groq)."""
    return OpenAI(
        api_key=settings.AI_API_KEY,
        base_url=settings.openai_base_url,
    )


def _get_provider_client(provider_id: str) -> OpenAI:
    """Return a cached OpenAI client for a named provider."""
    cached = _clients.get(provider_id)
    if cached is not None:
        return cached
    base_url = provider_base_url(provider_id)
    key = provider_key(provider_id)
    client = OpenAI(api_key=key, base_url=base_url) if base_url else OpenAI(api_key=key)
    _clients[provider_id] = client
    return client


def _parse_model_spec(spec: str) -> tuple[str | None, str | None]:
    """Splits 'provider@model' into (provider_id, model_id)."""
    if not spec:
        return None, None
    if "@" in spec:
        provider_id, _, model_id = spec.partition("@")
        return provider_id.strip(), model_id.strip()
    return "groq", spec.strip()


def _resolve_model(spec: str) -> tuple[str, str]:
    """Turn the user's model selector into (provider_id, model_id).

    Raises RuntimeError with a friendly message for unknown providers,
    unconfigured keys, or unknown model ids.
    """
    provider_id, model_id = _parse_model_spec(spec)

    if provider_id is None:
        # No selector: use the legacy default (Groq + .env AI_MODEL).
        if not settings.has_api_key():
            raise RuntimeError("AI_API_KEY is missing from your .env file.")
        return "groq", settings.AI_MODEL or "qwen/qwen3.8-27b"

    provider = provider_config(provider_id)
    if not provider:
        raise RuntimeError(f"Unknown AI provider: {provider_id!r}.")

    if not provider_configured(provider_id):
        raise RuntimeError(
            f"{provider['label']} isn't available yet. Add {provider['key_env']} "
            "to the server environment, then it will appear in Settings."
        )

    chosen = model_id or provider["default"]
    if model_id and model_id not in provider["models"] and not provider["custom"]:
        raise RuntimeError(
            f"Unknown model {model_id!r} for {provider['label']}."
        )
    return provider_id, chosen


def _provider_reason(exc: APIError) -> str:
    """Return a short, human-readable reason pulled from a provider error body."""
    body = getattr(exc, "body", None)
    msg = ""
    try:
        if isinstance(body, dict):
            err = body.get("error", body)
            msg = str(err.get("message", err) if isinstance(err, dict) else err)
        elif isinstance(body, list) and body:
            first = body[0]
            if isinstance(first, dict):
                err = first.get("error", first)
                msg = str(err.get("message", err) if isinstance(err, dict) else err)
        elif isinstance(body, str):
            msg = body
    except Exception:
        return ""
    msg = " ".join(msg.split())
    return msg[:220]


def _provider_failure(exc: Exception, provider_id: str, action: str) -> RuntimeError:
    """Map any provider exception to a short, human-readable RuntimeError.

    Shared by the chat, stream, image and document paths so the wording stays
    identical everywhere. Never leaks keys or raw internals.
    """
    if isinstance(exc, AuthenticationError):
        logger.error("Invalid API key for %s.", provider_id)
        env_name = PROVIDERS.get(provider_id, {}).get("key_env", "AI_API_KEY")
        return RuntimeError(
            f"Authentication failed: the API key is invalid or expired. "
            f"Check {env_name} on the server."
        )
    if isinstance(exc, RateLimitError):
        logger.error("Rate limit hit for %s.", provider_id)
        # A used-up daily quota also arrives as a 429, but waiting a moment will
        # not clear it, so do not send the user down that dead end.
        detail = f"{getattr(exc, 'message', '') or ''} {exc}".lower()
        if any(
            marker in detail
            for marker in ("quota", "per day", "resource_exhausted", "per_day")
        ):
            return RuntimeError(
                "The AI provider's daily quota is used up, so it can't work right "
                "now. It resets later today - try again after that or pick another "
                "model."
            )
        return RuntimeError("Rate limit reached. Wait a moment and try again.")
    if isinstance(exc, APIConnectionError):
        logger.error("Could not reach the provider %s.", provider_id)
        return RuntimeError(
            "Could not reach the AI service. Check your internet connection "
            "and the provider base URL."
        )
    if isinstance(exc, APIError):
        status = getattr(exc, "status_code", 0) or 0
        reason = _provider_reason(exc)
        logger.error("%s provider API error (status %s): %s", provider_id, status, reason)
        if status == 404:
            message = (
                "The selected model was not found (404). It may have been "
                "retired — pick another model in the model bar."
            )
        elif status == 503:
            message = "The model is busy right now (high demand). Try again in a moment."
        elif status >= 500:
            message = (
                "The AI provider had a server error (status %s). Try again shortly."
                % status
            )
        elif status in (400, 401, 403, 422):
            message = (
                "The provider rejected the request (status %s). Check the model name."
                % status
            )
        else:
            message = (
                "The AI service returned an error (status %s). "
                "Check the provider configuration." % status
            )
        if reason:
            message += " Provider says: " + reason
        return RuntimeError(message)

    logger.exception("Unexpected error while %s.", action)
    return RuntimeError(f"An unexpected error happened while {action}.")


def _system_prompt(language: str) -> str:
    """Build the system prompt, honouring the preferred reply language."""
    if language and language.lower() not in ("default", "none"):
        return (
            f"{SYSTEM_PROMPT} Reply in {language} for every answer unless the "
            "user writes in another language."
        )
    return SYSTEM_PROMPT


def get_assistant_reply(messages: list[dict], language: str = "", model: str = "") -> str:
    """Add the system prompt, call the model, and return Nova's reply."""
    provider_id, chosen_model = _resolve_model(model)
    is_default = provider_id == "groq"

    try:
        client = get_client() if is_default else _get_provider_client(provider_id)
        full_messages = [{"role": "system", "content": _system_prompt(language)}] + messages

        response = client.chat.completions.create(
            model=chosen_model,
            messages=full_messages,
            temperature=0.7,
        )

        reply = response.choices[0].message.content
        if not reply or not reply.strip():
            return "I am sorry, I could not generate a reply. Please try again."
        return reply.strip()

    except Exception as exc:
        raise _provider_failure(exc, provider_id, "talking to the AI service") from None


def stream_assistant_reply(
    messages: list[dict], language: str = "", model: str = "",
    images: list[str] | None = None, documents: list[dict] | None = None,
) -> Iterator[str]:
    """Yield Nova's reply text chunks as the provider streams them back.

    Uses the same model/provider selection and error handling as
    get_assistant_reply(), but with stream=True so first tokens arrive fast.
    Attachments are optional, so the voice page keeps its simple text path.
    """
    images = images or []
    documents = documents or []
    provider_id, chosen_model = _resolve_model(model)
    note = ""

    if images:
        provider_id = "gemini"
        chosen_model = settings.VISION_MODEL
        note = f"Answered with {settings.VISION_MODEL} so Nova can see your image."

    try:
        client = get_client() if provider_id == "groq" else _get_provider_client(provider_id)
        full_messages = [{"role": "system", "content": _system_prompt(language)}] + messages
        if (images or documents) and full_messages and full_messages[-1]["role"] == "user":
            full_messages[-1] = {
                "role": "user",
                "content": _attachment_content(
                    full_messages[-1]["content"], images, documents
                ),
            }

        stream = client.chat.completions.create(
            model=chosen_model,
            messages=full_messages,
            temperature=0.7,
            stream=True,
        )

        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content
        if note:
            yield f"\n\n_{note}_"

    except Exception as exc:
        raise _provider_failure(exc, provider_id, "streaming a reply") from None


def _attachment_content(text, images=None, documents=None) -> list[dict]:
    """Build a multimodal content array from a plain-text user message.

    Order: documents first, then images, then the user's own words, so the
    instruction stays closest to where the model starts answering.
    """
    parts: list[dict] = []

    for doc in documents or []:
        name = (doc.get("name") or "document").strip() or "document"
        body = (doc.get("text") or "").strip()[: settings.MAX_DOC_CHARS]
        if not body:
            continue
        parts.append(
            {"type": "text", "text": f"Attached document: {name}\n---\n{body}\n---"}
        )

    for url in images or []:
        parts.append({"type": "image_url", "image_url": {"url": url}})

    prompt = (text or "").strip()
    if prompt:
        parts.append({"type": "text", "text": prompt})
    elif not parts:
        parts.append({"type": "text", "text": "Please describe what you see."})

    return parts


def chat_with_attachments(
    messages: list[dict],
    images: list[str] | None = None,
    documents: list[dict] | None = None,
    language: str = "",
    model: str = "",
) -> tuple[str, str]:
    """Reply to a message that carries images and/or documents.

    Groq's chat models are text-only, so anything visual is routed to Gemini.
    Returns (reply, note) where note explains any automatic model switch.
    """
    images = images or []
    documents = documents or []
    provider_id, chosen_model = _resolve_model(model)
    note = ""

    if images and provider_id != "gemini":
        note = f"Answered with {settings.VISION_MODEL} so Nova can see your image."
        provider_id = "gemini"
        chosen_model = settings.VISION_MODEL

    if not settings.has_vision_model():
        raise RuntimeError(
            "Image and document support is unavailable. Add GEMINI_API_KEY to the "
            "server environment, then restart the server."
        )

    try:
        client = _get_provider_client(provider_id)
        full_messages = [{"role": "system", "content": _system_prompt(language)}] + messages
        if full_messages and full_messages[-1]["role"] == "user":
            full_messages[-1] = {
                "role": "user",
                "content": _attachment_content(
                    full_messages[-1]["content"], images, documents
                ),
            }

        response = client.chat.completions.create(
            model=chosen_model,
            messages=full_messages,
            temperature=0.7,
        )

        reply = response.choices[0].message.content
        if not reply or not reply.strip():
            return "I am sorry, I could not generate a reply. Please try again.", note
        return reply.strip(), note

    except Exception as exc:
        raise _provider_failure(exc, provider_id, "reading your attachments") from None


def _normalise_image_url(url) -> str:
    """Accept only URLs we can safely hand to the browser."""
    if isinstance(url, dict):
        url = url.get("url")
    if not isinstance(url, str):
        return ""
    if url.startswith("data:image/") or url.startswith("http"):
        return url
    return ""


def _svg_data_url(svg: str) -> str:
    """Wrap SVG markup in a data URL so an <img> tag can render it."""
    svg = (svg or "").strip()
    if "<svg" not in svg.lower():
        return ""
    if "xmlns=" not in svg:
        svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return "data:image/svg+xml;base64," + encoded


def _find_svg(text: str) -> str:
    """Pull SVG markup out of a model reply (fenced or inline)."""
    if not text:
        return ""
    fenced = re.search(
        r"```(?:svg|xml|html)?[^\n]*\n?(<svg[\s\S]*?</svg>)```", text, re.IGNORECASE
    )
    if fenced:
        return fenced.group(1)
    inline = re.search(r"(<svg[\s\S]*?</svg>)", text, re.IGNORECASE)
    return inline.group(1) if inline else ""


def _extract_image_url(response) -> str:
    """Find the generated image across the shapes providers return."""
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    if message is None:
        return ""

    # OpenRouter-style: message.images = [{"image_url": {"url": ...}}]
    for img in getattr(message, "images", None) or []:
        url = _normalise_image_url(getattr(img, "image_url", None))
        if url:
            return url

    content = getattr(message, "content", None)

    if isinstance(content, list):
        for part in content:
            raw = getattr(part, "image_url", None)
            if raw is None and isinstance(part, dict):
                raw = part.get("image_url")
            url = _normalise_image_url(raw)
            if url:
                return url

    if isinstance(content, str):
        match = re.search(r"data:image/[^)\s\"']+;base64,[A-Za-z0-9+/=]+", content)
        if match:
            return match.group(0)
        # Chat models have no raster image output, but they do draw excellent SVG.
        svg_url = _svg_data_url(_find_svg(content))
        if svg_url:
            return svg_url

    return ""


def generate_image(prompt: str, model: str = "") -> str:
    """Generate an image from a text prompt and return it as a data URL."""
    provider_id, _ = _resolve_model(model)
    chosen_model = settings.IMAGE_MODEL

    if not settings.has_image_model():
        raise RuntimeError(
            "Image generation is unavailable. Add GEMINI_API_KEY to the server "
            "environment, then restart the server."
        )

    try:
        client = _get_provider_client("gemini")
        response = client.chat.completions.create(
            model=chosen_model,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Draw this as an illustration: {prompt.strip()}\n\n"
                        "Reply with ONLY valid SVG markup - no explanation, no markdown "
                        "fences, no HTML wrapper. Include a viewBox and set width and "
                        "height so it renders on its own."
                    ),
                }
            ],
        )
        image_url = _extract_image_url(response)
    except Exception as exc:
        raise _provider_failure(exc, provider_id or "gemini", "generating the image") from None

    if not image_url:
        raise RuntimeError(
            "The image model did not return an image. Try rephrasing your prompt."
        )
    return image_url


def extract_document_text(data: bytes, filename: str, content_type: str = "") -> str:
    """Turn an uploaded file into plain text (PDF via pypdf, else utf-8)."""
    is_pdf = filename.lower().endswith(".pdf") or (content_type or "").startswith(
        "application/pdf"
    )
    if not is_pdf:
        return data.decode("utf-8", errors="replace")

    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = reader.pages[: settings.MAX_PDF_PAGES]
        chunks = [(page.extract_text() or "") for page in pages]
    except Exception as exc:
        logger.error("PDF extraction failed: %s", exc)
        return ""

    text = "\n\n".join(chunk for chunk in chunks if chunk.strip()).strip()
    if not text:
        logger.warning("PDF produced no text (likely a scanned image).")
    return text


def transcribe_audio(data: bytes, filename: str) -> str:
    """Transcribe recorded audio to text with Groq Whisper."""
    try:
        result = get_client().audio.transcriptions.create(
            model=settings.AI_STT_MODEL,
            file=(filename, data, "audio/webm"),
        )
    except AuthenticationError:
        logger.error("Invalid API key during transcription.")
        raise RuntimeError(
            "Authentication failed for speech recognition. Check AI_API_KEY on the server."
        ) from None
    except APIConnectionError:
        logger.error("Could not reach Groq for transcription.")
        raise RuntimeError(
            "Could not reach the speech service. Check your internet connection."
        ) from None
    except APIError as exc:
        logger.error("Transcription API error (status %s): %s",
                     getattr(exc, "status_code", 0), _provider_reason(exc))
        raise RuntimeError(
            "I could not process that audio right now. Please try again."
        ) from None
    except Exception as exc:
        logger.exception("Unexpected error during transcription.")
        raise RuntimeError(
            "An unexpected error happened while recognizing speech."
        ) from exc

    text = (result.text or "").strip()
    if not text:
        raise RuntimeError("I could not hear any speech. Please try again.")
    return text


# Voices supported by the configured Groq TTS model.
VOICES = ["autumn", "diana", "hannah", "austin", "daniel", "troy"]


def synthesize_speech(text: str, voice: str, speed: float = 1.0) -> bytes:
    """Turn text into spoken audio bytes (wav) with Groq TTS."""
    try:
        response = get_client().audio.speech.create(
            model=settings.AI_TTS_MODEL,
            voice=voice,
            input=text,
            response_format="wav",
            speed=speed,
        )
    except AuthenticationError:
        logger.error("Invalid API key during speech synthesis.")
        raise RuntimeError(
            "Authentication failed for speech synthesis. Check AI_API_KEY on the server."
        ) from None
    except APIConnectionError:
        logger.error("Could not reach Groq for speech synthesis.")
        raise RuntimeError(
            "Could not reach the speech service. Check your internet connection."
        ) from None
    except APIError as exc:
        reason = _provider_reason(exc).lower()
        logger.error("Speech synthesis API error (status %s): %s",
                     getattr(exc, "status_code", 0), reason)
        raise RuntimeError(
            "I could not generate the audio for that voice. Please try again."
        ) from None
    except Exception as exc:
        logger.exception("Unexpected error during speech synthesis.")
        raise RuntimeError(
            "An unexpected error happened while generating speech."
        ) from exc

    audio = response.content
    if not audio:
        raise RuntimeError("The speech service returned empty audio.")
    return audio


def list_voices() -> dict:
    """Return the supported TTS voices for the configured model."""
    return {"model": settings.AI_TTS_MODEL, "voices": VOICES}