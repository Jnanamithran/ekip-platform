import Card from "../ui/Card";
import CitationTab from "./CitationTab";

export default function AnswerResult({ result, onPreview }) {
  const { answer, sources = [] } = result;

  return (
    <Card className="p-5">
      <p className="font-display text-base leading-relaxed text-ink">
        {answer}
      </p>

      {result.answer_summary && (
        <p className="mt-3 text-xs text-slate" aria-label="Answer basis">
          {result.answer_summary}
        </p>
      )}

      {sources.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-light">
            Sources
          </span>
          {sources.map((source, i) => (
            <CitationTab
              key={source.id}
              source={source}
              index={i + 1}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
