import os

from dotenv import load_dotenv

# Load the .env file in the project root (if it exists).
load_dotenv()


class Settings:
    """Central place for all configuration values."""

    # Default values that can be overridden in the .env file.
    AI_API_KEY: str = os.getenv("AI_API_KEY", "").strip()
    AI_BASE_URL: str = os.getenv("AI_BASE_URL", "").strip()
    AI_MODEL: str = os.getenv("AI_MODEL", "").strip()

    APP_HOST: str = os.getenv("APP_HOST", "127.0.0.1").strip()
    APP_PORT: int = int(os.getenv("APP_PORT", "8000"))

    # Safety limits so a runaway conversation can never break the app.
    MAX_MESSAGE_LENGTH: int = 4000
    MAX_HISTORY_MESSAGES: int = 40

    @property
    def openai_base_url(self) -> str:
        # Empty means "use the official OpenAI default URL".
        return self.AI_BASE_URL or "https://api.openai.com/v1"

    def has_api_key(self) -> bool:
        # Treat empty values and the .env.example placeholder as "not set".
        return bool(self.AI_API_KEY) and self.AI_API_KEY not in {
            "put_your_api_key_here",
            "your_api_key_here",
        }

    def has_model(self) -> bool:
        # Same trick for the model name from .env.example.
        return bool(self.AI_MODEL) and self.AI_MODEL not in {
            "put_your_model_name_here",
            "your_model_name_here",
        }


settings = Settings()

# ------------------------------------------------------------------
# Model providers — every entry speaks the OpenAI chat API, so a single
# OpenAI client works for all of them. Keys stay server-side only.
# ------------------------------------------------------------------

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# provider id -> config
PROVIDERS = {
    "groq": {
        "label": "Groq",
        "key_env": "AI_API_KEY",
        "base_url": settings.AI_BASE_URL
        or GROQ_BASE_URL,  # respect a custom AI_BASE_URL override
        "models": [
            "qwen/qwen3.8-27b",
            "allam-2-7b",
            "openai/gpt-oss-20b",
            "openai/gpt-oss-120b",
        ],
        "default": "qwen/qwen3.8-27b",
        "custom": True,
        "labels": {
            "qwen/qwen3.8-27b": "Qwen 3.8",
            "allam-2-7b": "Allam 2",
            "openai/gpt-oss-20b": "GPT-OSS 20B",
            "openai/gpt-oss-120b": "GPT-OSS 120B",
        },
    },
    "gemini": {
        "label": "Google Gemini",
        "key_env": "GEMINI_API_KEY",
        "base_url": GEMINI_BASE_URL,
        "models": [
            "gemini-3.6-flash",
            "gemini-3.8-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-pro-preview",
        ],
        "default": "gemini-3.6-flash",
        "custom": True,
        "labels": {
            "gemini-3.6-flash": "3.6 Flash",
            "gemini-3.8-flash": "3.8 Flash",
            "gemini-3.5-flash-lite": "3.5 Flash-Lite",
            "gemini-3.1-pro-preview": "3.1 Pro",
        },
    },
    "openrouter": {
        "label": "OpenRouter",
        "key_env": "OPENROUTER_API_KEY",
        "base_url": OPENROUTER_BASE_URL,
        "models": ["openai/gpt-4o-mini", "meta-llama/llama-3.3-70b-instruct"],
        "default": "openai/gpt-4o-mini",
        "custom": True,
        "labels": {
            "openai/gpt-4o-mini": "GPT-4o mini",
            "meta-llama/llama-3.3-70b-instruct": "Llama 3.3 70B",
        },
    },
}

_EMPTY_KEY_HINTS = {"put_your_api_key_here", "your_api_key_here"}


def provider_config(provider_id: str):
    return PROVIDERS.get(provider_id)


def provider_key(provider_id: str) -> str:
    cfg = provider_config(provider_id)
    if not cfg:
        return ""
    return os.getenv(cfg["key_env"], "").strip()


def provider_configured(provider_id: str) -> bool:
    key = provider_key(provider_id)
    return bool(key) and key not in _EMPTY_KEY_HINTS


def provider_base_url(provider_id: str) -> str:
    cfg = provider_config(provider_id)
    return cfg["base_url"] if cfg else None