import { useState } from "react";
import { askQuestion, getAskProgress } from "../lib/apiClient";
import AnswerResult from "../components/citations/AnswerResult";
import Button from "../components/ui/Button";

export default function Search() {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState([]); // [{ query, result }]
  const [loading, setLoading] = useState(false);
  const [processingStage, setProcessingStage] = useState("");
  const [progressError, setProgressError] = useState("");

  async function runQuery(q) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
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
      setHistory((h) => [...h, { query: trimmed, result }]);
    } catch (err) {
      setHistory((h) => [...h, { query: trimmed, result: { error: err.message } }]);
    } finally {
      polling = false;
      setLoading(false);
      setProcessingStage("");
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Search</h1>
        <p className="text-sm text-slate">
          Ask a question across every connected document in your workspace.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runQuery(query);
        }}
        className="flex gap-2"
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

      <div className="flex flex-col gap-4">
        {history.map((entry, i) => (
          <div key={i} className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink-soft">{entry.query}</p>
            {entry.result?.error ? (
              <p className="text-sm text-danger">{entry.result.error}</p>
            ) : (
              <AnswerResult result={entry.result} />
            )}
          </div>
        ))}

        {loading && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-slate">
              <span className="h-2 w-2 animate-pulse rounded-full bg-index" />
              <span>{processingStage || "Working on your answer"}</span>
            </div>
            {progressError && <p role="status" className="text-xs text-slate">{progressError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
