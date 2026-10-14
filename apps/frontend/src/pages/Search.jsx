import { useEffect, useRef, useState } from "react";
import { askQuestion, getAnswerHistory, getAskProgress } from "../lib/apiClient";
import AnswerResult from "../components/citations/AnswerResult";
import PdfPreview from "../components/documents/PdfPreview";
import Button from "../components/ui/Button";

export default function Search() {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState([]); // [{ query, result }]
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [processingStage, setProcessingStage] = useState("");
  const [progressError, setProgressError] = useState("");
  const [preview, setPreview] = useState(null);
  const latestMessageRef = useRef(null);

  useEffect(() => {
    let active = true;
    getAnswerHistory()
      .then((result) => {
        if (active) setHistory(result.entries);
      })
      .catch((err) => {
        if (active) setHistoryError(err.message);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!historyLoading) {
      latestMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [history.length, historyLoading, loading]);

  async function runQuery(q) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setCurrentQuestion(trimmed);
    setProgressError("");
    setQuery("");
    const requestId = crypto.randomUUID();
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        if (!polling) break;
        try {
          const progress = await getAskProgress(requestId);
          if (polling) {
            setProcessingStage(progress.stage);
            setProgressError("");
          }
        } catch (err) {
          if (polling) setProgressError(`Search status unavailable: ${err.message}`);
        }
      }
    };
    setProcessingStage("Starting your search");
    pollProgress();
    try {
      const result = await askQuestion(trimmed, requestId);
      setHistory((h) => [...h, { id: result.history_id || requestId, query: trimmed, result }]);
    } catch (err) {
      setHistory((h) => [...h, { query: trimmed, result: { error: err.message } }]);
    } finally {
      polling = false;
      setLoading(false);
      setCurrentQuestion("");
      setProcessingStage("");
    }
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 pb-32">
      <div>
        <h1 className="font-display text-xl text-ink">Search</h1>
        <p className="text-sm text-slate">
          Ask a question across every connected document in your workspace.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {historyLoading && <p role="status" className="text-sm text-slate">Loading question history…</p>}
        {historyError && <p role="alert" className="text-sm text-danger">{historyError}</p>}
        {history.map((entry) => (
          <div key={entry.id || `${entry.query}-${entry.created_at}`} className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink-soft">{entry.query}</p>
            {entry.result?.error ? (
              <p className="text-sm text-danger">{entry.result.error}</p>
            ) : (
              <AnswerResult result={entry.result} onPreview={(documentId, filename, page) => {
                setPreview({ documentId, filename, page });
              }} />
            )}
          </div>
        ))}

        {loading && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className="text-sm font-medium text-ink-soft">You asked: {currentQuestion}</p>
            <div className="flex items-center gap-2 text-sm text-slate">
              <span className="h-2 w-2 animate-pulse rounded-full bg-index" />
              <span>{processingStage || "Preparing to search your documents"}</span>
            </div>
            {progressError && <p role="status" className="text-xs text-slate">{progressError}</p>}
          </div>
        )}
        <div ref={latestMessageRef} aria-hidden="true" />
      </div>
      <div className="fixed bottom-0 left-60 right-0 z-30 border-t border-hairline bg-paper/95 px-6 py-4 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runQuery(query);
          }}
          className="mx-auto flex max-w-2xl gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 rounded-md border border-hairline bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-slate-light focus:border-index focus:outline-none"
          />
          <Button type="submit" disabled={loading}>
            {loading ? "Searching\u2026" : "Ask"}
          </Button>
        </form>
      </div>
      {preview && (
        <PdfPreview
          documentId={preview.documentId}
          filename={preview.filename}
          page={preview.page}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
