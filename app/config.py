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

    # Audio / voice models (Groq Whisper + Groq Orpheus TTS).
    AI_STT_MODEL: str = os.getenv("AI_STT_MODEL", "whisper-large-v3-turbo").strip()
    AI_TTS_MODEL: str = os.getenv("AI_TTS_MODEL", "canopylabs/orpheus-v1-english").strip()

    APP_HOST: str = os.getenv("APP_HOST", "127.0.0.1").strip()
    APP_PORT: int = int(os.getenv("APP_PORT", "8000"))

    # Safety limits so a runaway conversation can never break the app.
    MAX_MESSAGE_LENGTH: int = 4000
    MAX_HISTORY_MESSAGES: int = 40

    # Uploads / attachments.
    MAX_IMAGES_PER_MESSAGE: int = 4
    MAX_IMAGE_BYTES: int = 3_000_000       # decoded image payload cap (~3 MB)
    MAX_UPLOAD_MB: int = 10                # audio + document file cap (MB)
    MAX_DOCUMENT_CHARS: int = 12_000       # extracted document text cap
    MAX_SPEECH_CHARS: int = 2000           # text that may be spoken in one call

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