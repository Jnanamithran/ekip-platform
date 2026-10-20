export default function CitationTab({ source, index, onPreview, onTextPreview, onVisualPreview }) {
  const isPdf = source.filename?.toLowerCase().endsWith(".pdf");
  const isVisual = source.type === "visual";

  function handleCitationClick() {
    if (isVisual) {
      // Show the rendered page image (ColPali visual pipeline)
      if (onVisualPreview) onVisualPreview(source);
      else if (onPreview && source.document_id)
        onPreview(source.document_id, source.filename, source.page);
      return;
    }
    if (isPdf) {
      if (source.document_id && onPreview)
        onPreview(source.document_id, source.filename, source.page);
      return;
    }
    if (source.excerpt && onTextPreview)
      onTextPreview(source.filename, source.page, source.excerpt);
  }

  return (
    <div className="rounded-md border border-signal/30 bg-signal-soft/60 px-3 py-2">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
              bg-signal text-[10px] font-semibold text-white"
          >
            {index}
          </span>
          <span className="truncate font-mono text-ink-soft">
            {source.filename}
            {source.page != null && (
              <span className="text-slate"> &middot; p.{source.page}</span>
            )}
          </span>
          <span className="ml-auto text-slate-light transition-transform group-open:rotate-180">
            &#x25BE;
          </span>
        </summary>
        <div className="border-t border-signal/20 pt-2">
          <p className="font-mono text-xs leading-relaxed text-slate">
            {source.excerpt}
          </p>
        </div>
      </details>
      {isVisual && source.document_id ? (
          <button
            type="button"
            onClick={handleCitationClick}
            className="mt-2 text-left text-xs font-medium text-index underline underline-offset-2"
          >
            View page image (p. {source.page || 1})
          </button>
      ) : isPdf && source.document_id && onPreview ? (
          <button
            type="button"
            onClick={handleCitationClick}
            className="mt-2 text-left text-xs font-medium text-index underline underline-offset-2"
          >
            Preview PDF at page {source.page || 1}
          </button>
      ) : isPdf ? (
        <p className="mt-2 text-xs text-slate">
          PDF preview unavailable. Re-upload this PDF to enable preview.
        </p>
      ) : source.excerpt && onTextPreview ? (
        <button
          type="button"
          onClick={handleCitationClick}
          className="mt-2 text-left text-xs font-medium text-index underline underline-offset-2"
        >
          View full excerpt
        </button>
      ) : null}
    </div>
  );
}
