import logging

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


def get_assistant_reply(messages: list[dict], language: str = "", model: str = "") -> str:
    """Add the system prompt, call the model, and return Nova's reply."""
    provider_id, chosen_model = _resolve_model(model)
    is_default = provider_id == "groq"

    system_prompt = SYSTEM_PROMPT
    if language and language.lower() not in ("default", "none"):
        system_prompt = (
            f"{system_prompt} Reply in {language} for every answer unless the "
            "user writes in another language."
        )

    try:
        client = get_client() if is_default else _get_provider_client(provider_id)
        full_messages = [{"role": "system", "content": system_prompt}] + messages

        response = client.chat.completions.create(
            model=chosen_model,
            messages=full_messages,
            temperature=0.7,
        )

        reply = response.choices[0].message.content
        if not reply or not reply.strip():
            return "I am sorry, I could not generate a reply. Please try again."
        return reply.strip()

    except AuthenticationError:
        logger.error("Invalid API key for %s.", provider_id)
        raise RuntimeError(
            "Authentication failed: the API key is invalid or expired. "
            f"Check {PROVIDERS[provider_id]['key_env']} on the server."
        ) from None
    except RateLimitError:
        logger.error("Rate limit hit for %s.", provider_id)
        raise RuntimeError(
            "Rate limit reached. Wait a moment and try again."
        ) from None
    except APIConnectionError:
        logger.error("Could not reach the provider %s.", provider_id)
        raise RuntimeError(
            "Could not reach the AI service. Check your internet connection "
            "and the provider base URL."
        ) from None
    except APIError as exc:
        status = getattr(exc, "status_code", 0) or 0
        reason = _provider_reason(exc)
        logger.error("%s provider API error (status %s): %s", provider_id, status, reason)
        if status == 404:
            message = (
                "The selected model was not found (404). It may have been "
                "retired — pick another model in the model bar."
            )
        elif status == 503:
            message = (
                "The model is busy right now (high demand). Try again in a moment."
            )
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
        raise RuntimeError(message) from None
    except Exception as exc:
        # Never leak secrets or raw internals to the user.
        logger.exception("Unexpected error while calling the AI provider.")
        raise RuntimeError(
            "An unexpected error happened while talking to the AI service."
        ) from exc