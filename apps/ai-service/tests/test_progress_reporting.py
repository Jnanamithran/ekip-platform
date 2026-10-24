import asyncio

import httpx
import pytest

import main


class FakeAsyncClient:
    def __init__(self, status_code):
        self.status_code = status_code

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        return httpx.Response(
            self.status_code,
            request=httpx.Request("POST", "http://localhost/progress"),
        )


class FakeSyncClient:
    def __init__(self, status_code):
        self.status_code = status_code

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, *args, **kwargs):
        return httpx.Response(
            self.status_code,
            request=httpx.Request("POST", "http://localhost/progress"),
        )


def test_async_progress_ignores_expired_access_token(monkeypatch):
    monkeypatch.setattr(
        main.httpx,
        "AsyncClient",
        lambda **kwargs: FakeAsyncClient(status_code=401),
    )

    asyncio.run(main.report_progress("expired-token", "/progress", stage="Parsing"))


def test_sync_progress_ignores_expired_access_token(monkeypatch):
    monkeypatch.setattr(
        main.httpx,
        "Client",
        lambda **kwargs: FakeSyncClient(status_code=401),
    )

    main.report_progress_sync("expired-token", "/progress", stage="Embedding")


@pytest.mark.parametrize("status_code", [403, 500])
def test_progress_still_reports_non_authentication_failures(monkeypatch, status_code):
    monkeypatch.setattr(
        main.httpx,
        "AsyncClient",
        lambda **kwargs: FakeAsyncClient(status_code=status_code),
    )

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(main.report_progress("valid-token", "/progress", stage="Parsing"))
