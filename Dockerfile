FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN groupadd --gid 10001 optistock && useradd --uid 10001 --gid optistock --create-home optistock
COPY requirements.lock ./
RUN pip install -r requirements.lock
COPY pyproject.toml alembic.ini ./
COPY backend ./backend
COPY migrations ./migrations
RUN pip install --no-deps . && mkdir -p /app/var/files && chown -R optistock:optistock /app/var
USER optistock
EXPOSE 8000
CMD ["uvicorn", "optistock.api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1", "--limit-concurrency", "50", "--timeout-keep-alive", "5"]
