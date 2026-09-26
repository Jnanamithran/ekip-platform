import { useState } from "react";
import { askEkip } from "../mocks/queryResults";
import AnswerResult from "../components/citations/AnswerResult";
import Button from "../components/ui/Button";

const SUGGESTIONS = [
  "What's the hotel cap under the travel policy?",
  "How much paid leave do I accrue per month?",
  "Walk me through new hire onboarding.",
];

export default function Search() {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState([]); // [{ query, result }]
  const [loading, setLoading] = useState(false);

  async function runQuery(q) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setQuery("");
    const result = await askEkip(trimmed);
    setHistory((h) => [...h, { query: trimmed, result }]);
    setLoading(false);
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
          placeholder="Ask about a policy, process, or document…"
          className="flex-1 rounded-md border border-hairline bg-paper-raised px-3
            py-2 text-sm text-ink placeholder:text-slate-light
            focus:border-index focus:outline-none"
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Ask"}
        </Button>
      </form>

      {history.length === 0 && !loading && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-light">
            Try asking
          </span>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => runQuery(s)}
                className="rounded-full border border-hairline bg-paper-raised px-3
                  py-1.5 text-xs text-slate hover:border-index hover:text-index"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {history.map((entry, i) => (
          <div key={i} className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink-soft">{entry.query}</p>
            <AnswerResult result={entry.result} />
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate">
            <span className="h-2 w-2 animate-pulse rounded-full bg-index" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-index [animation-delay:150ms]" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-index [animation-delay:300ms]" />
            <span className="ml-1">Searching connected documents…</span>
          </div>
        )}
      </div>
    </div>
  );
}
