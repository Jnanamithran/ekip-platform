import { useEffect } from "react";

/**
 * Full-screen modal that shows a non-PDF citation's text excerpt.
 *
 * Props:
 *   filename  - display name shown in the header
 *   page      - optional page / sheet number
 *   excerpt   - the plain-text content to display
 *   onClose   - callback to dismiss the modal
 */
export default function TextPreviewModal({ filename, page, excerpt, onClose }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Text preview: ${filename}`}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-paper"
      >
        {/* ---- header ---- */}
        <header className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-ink">
              {filename}
            </h2>
            {page != null && (
              <p className="text-xs text-slate">Page {page}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close text preview"
            className="rounded px-3 py-1 text-lg text-slate hover:bg-paper-raised hover:text-ink"
          >
            &#x2715;
          </button>
        </header>

        {/* ---- body ---- */}
        <div className="flex-1 overflow-y-auto p-5">
          {excerpt ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-ink-soft">
              {excerpt}
            </pre>
          ) : (
            <p className="text-sm text-slate">
              No text content available for this citation.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
