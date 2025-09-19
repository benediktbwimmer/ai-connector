from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: Optional[str] = Field(default=None, env="OPENAI_API_KEY")
    openai_base_url: str = Field(
        default="https://api.openai.com/v1", env="OPENAI_BASE_URL"
    )
    ollama_base_url: str = Field(
        default="http://127.0.0.1:11434", env="OLLAMA_BASE_URL"
    )
    default_openai_model: str = Field(default="gpt-4o-mini")
    default_ollama_model: str = Field(default="gpt-oss:20b")
    port: int = Field(default=8000, env="PORT")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
