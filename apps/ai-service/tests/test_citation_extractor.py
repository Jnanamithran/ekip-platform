from types import SimpleNamespace

from citations.extractor import extract_citations


def test_extracts_source_marker_with_inline_filename_and_page():
    chunk = SimpleNamespace(
        filename='progit.pdf',
        page_num=16,
        text='Git records changes to files.',
        chunk_id='chunk-1',
        document_id='document-1',
    )
    generation_result = SimpleNamespace(
        answer='Git records changes over time [SOURCE 1 | progit.pdf | page 16].',
        context_chunks=[chunk],
        model='test-model',
    )

    cited = extract_citations(generation_result, 'What is Git?')

    assert len(cited.citations) == 1
    assert cited.citations[0].filename == 'progit.pdf'
    assert cited.citations[0].page_num == 16
    assert cited.citations[0].document_id == 'document-1'
