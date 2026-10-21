from types import SimpleNamespace

from generation import generator


class FakeOllama:
    def __init__(self, content):
        self.content = content
        self.request = None

    def chat(self, **request):
        self.request = request
        return {"message": {"content": self.content}}


def make_chunk(text):
    return SimpleNamespace(
        filename="policy.txt",
        page_num=1,
        text=text,
        chunk_id="chunk-1",
        document_id="document-1",
    )


def test_generation_returns_only_verified_document_quotes(monkeypatch):
    chunk = make_chunk("Annual leave is 20 days per year.")
    client = FakeOllama(
        '{"can_answer":true,"evidence":[{"source":1,"quote":"Annual leave is 20 days per year."}]}'
    )
    monkeypatch.setattr(generator, "OLLAMA_CLIENT", client)

    result = generator.generate_answer("How much annual leave?", [chunk])

    assert "Annual leave is 20 days per year." in result.answer
    assert "[SOURCE 1]" in result.answer
    assert client.request["messages"][0]["role"] == "system"
    assert client.request["format"] == "json"


def test_generation_refuses_unverified_or_missing_evidence(monkeypatch):
    chunk = make_chunk("Annual leave is 20 days per year.")
    client = FakeOllama(
        '{"can_answer":true,"evidence":[{"source":1,"quote":"Annual leave is unlimited."}]}'
    )
    monkeypatch.setattr(generator, "OLLAMA_CLIENT", client)

    result = generator.generate_answer("How much annual leave?", [chunk])

    assert result.answer == generator.NO_DOCUMENT_ANSWER


def test_generation_refuses_when_model_cannot_answer(monkeypatch):
    chunk = make_chunk("Annual leave is 20 days per year.")
    client = FakeOllama(
        '{"can_answer":false,"evidence":[{"source":1,"quote":"Annual leave is 20 days per year."}]}'
    )
    monkeypatch.setattr(generator, "OLLAMA_CLIENT", client)

    result = generator.generate_answer("What is the capital of France?", [chunk])

    assert result.answer == generator.NO_DOCUMENT_ANSWER


def test_generation_refuses_when_no_authorized_chunks_exist():
    result = generator.generate_answer("What is the policy?", [])

    assert result.answer == generator.NO_DOCUMENT_ANSWER
    assert result.context_chunks == []
