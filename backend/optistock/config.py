from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OPTISTOCK_", env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://optistock@localhost:5435/optistock"
    storage_root: Path = Path("var/files")
    sample_root: Path = Path(".")
    cors_origins: list[str] = ["http://localhost:5173"]
    upload_max_bytes: int = 25 * 1024 * 1024
    xlsx_max_uncompressed_bytes: int = 250 * 1024 * 1024
    xlsx_max_rows: int = 400_000
    lease_seconds: int = Field(default=60, ge=10)
    job_timeout_seconds: int = Field(default=900, ge=30)
    max_attempts: int = Field(default=3, ge=1, le=10)
    openai_api_key: SecretStr = SecretStr("")
    openai_model: str = "gpt-5.4-mini-2026-03-17"
    ai_timeout_seconds: int = Field(default=45, ge=5, le=120)
    ai_requests_per_hour: int = Field(default=30, ge=1, le=300)
    # Budgets for the function-calling loop: model turns, tool executions, wall clock and tokens.
    ai_max_steps: int = Field(default=6, ge=1, le=12)
    ai_max_tool_calls: int = Field(default=12, ge=1, le=40)
    ai_total_seconds: int = Field(default=180, ge=10, le=600)
    ai_token_budget: int = Field(default=120_000, ge=2000, le=1_000_000)


@lru_cache
def settings() -> Settings:
    return Settings()
