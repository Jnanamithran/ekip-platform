import Card from "../ui/Card";
import CitationTab from "./CitationTab";

export default function AnswerResult({ result }) {
  const { answer, sources = [] } = result;

  return (
    <Card className="p-5">
      <p className="font-display text-base leading-relaxed text-ink">
        {answer}
      </p>

      {sources.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-light">
            Sources
          </span>
          {sources.map((source, i) => (
            <CitationTab key={source.id} source={source} index={i + 1} />
          ))}
        </div>
      )}
    </Card>
  );
}
