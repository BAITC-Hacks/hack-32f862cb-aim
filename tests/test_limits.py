import asyncio

import pytest
from optistock.middleware import BodyLimitMiddleware
from starlette.exceptions import HTTPException


def test_chunked_body_limit_without_content_length():
    messages = iter(
        [
            {"type": "http.request", "body": b"a" * 6, "more_body": True},
            {"type": "http.request", "body": b"b" * 6, "more_body": False},
        ]
    )

    async def receive():
        return next(messages)

    async def app(scope, receive, send):
        while (await receive()).get("more_body"):
            pass

    with pytest.raises(HTTPException) as exc:
        asyncio.run(BodyLimitMiddleware(app, max_bytes=10)({"type": "http"}, receive, None))
    assert exc.value.status_code == 413
