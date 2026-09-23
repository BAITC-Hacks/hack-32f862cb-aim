from functools import lru_cache
from pathlib import Path

from pydantic import Field
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


@lru_cache
def settings() -> Settings:
    return Settings()
