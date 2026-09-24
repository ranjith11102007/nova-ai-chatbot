import logging

from openai import OpenAI
from openai import APIError, APIConnectionError, AuthenticationError
from openai import RateLimitError

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


def get_client() -> OpenAI:
    """Build an OpenAI client for the configured provider."""
    return OpenAI(
        api_key=settings.AI_API_KEY,
        base_url=settings.openai_base_url,
    )


def get_assistant_reply(messages: list[dict]) -> str:
    """Add the system prompt, call the model, and return Nova's reply."""
    if not settings.has_api_key():
        raise RuntimeError("AI_API_KEY is missing from your .env file.")

    model = settings.AI_MODEL or "gpt-4o-mini"

    try:
        client = get_client()
        full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages

        response = client.chat.completions.create(
            model=model,
            messages=full_messages,
            temperature=0.7,
        )

        reply = response.choices[0].message.content
        if not reply or not reply.strip():
            return "I am sorry, I could not generate a reply. Please try again."
        return reply.strip()

    except AuthenticationError:
        logger.error("Invalid API key for the AI provider.")
        raise RuntimeError(
            "Authentication failed: your API key is invalid or expired. "
            "Check AI_API_KEY in your .env file."
        ) from None
    except RateLimitError:
        logger.error("Rate limit hit for the AI provider.")
        raise RuntimeError(
            "Rate limit reached. Wait a moment and try again."
        ) from None
    except APIConnectionError:
        logger.error("Could not reach the AI provider.")
        raise RuntimeError(
            "Could not reach the AI service. Check your internet connection "
            "and that AI_BASE_URL is correct."
        ) from None
    except APIError as exc:
        logger.error("AI provider API error: %s", exc)
        raise RuntimeError(
            "The AI service returned an error (status %s). "
            "Check your AI_BASE_URL and AI_MODEL." % exc.status_code
        ) from None
    except Exception as exc:
        # Never leak secrets or raw internals to the user.
        logger.exception("Unexpected error while calling the AI provider.")
        raise RuntimeError(
            "An unexpected error happened while talking to the AI service."
        ) from exc