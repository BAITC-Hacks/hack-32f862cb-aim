from starlette.exceptions import HTTPException


class BodyLimitMiddleware:
    """Bound chunked requests as well as requests that include Content-Length."""

    def __init__(self, app, max_bytes=50 * 1024 * 1024):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(413, "Лимит запроса 50 МБ")
            return message

        await self.app(scope, limited_receive, send)
