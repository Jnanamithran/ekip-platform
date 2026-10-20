import { useEffect, useState } from "react";
import { getPageImage } from "../../lib/apiClient";

/**
 * Full-screen modal that shows the rendered page image for a visual citation
 * (ColPali pipeline). Fetches the JPEG from the backend and displays it.
 *
 * Props:
 *   citation  - { document_id, filename, page | page_num, type: "visual" }
 *   onClose   - callback to dismiss the modal
 */
export default function PageImagePreview({ citation, onClose }) {
  const pageNum = citation.page ?? citation.page_num ?? 1;
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl;

    getPageImage(citation.document_id, pageNum)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [citation.document_id, pageNum]);

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
        aria-label={`Visual citation preview: ${citation.filename}`}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-paper"
      >
        {/* ---- header ---- */}
        <header className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-ink">
              {citation.filename}
            </h2>
            <p className="text-xs text-slate">
              Page {pageNum} · Retrieved visually (ColPali)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close visual citation preview"
            className="rounded px-3 py-1 text-lg text-slate hover:bg-paper-raised hover:text-ink"
          >
            &#x2715;
          </button>
        </header>

        {/* ---- body ---- */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="h-64 animate-pulse rounded bg-slate-100" />
          ) : error ? (
            <p role="alert" className="text-center text-sm text-danger">
              {error}
            </p>
          ) : (
            <img
              src={imageUrl}
              alt={`Page ${pageNum} of ${citation.filename}`}
              className="w-full rounded border border-hairline"
            />
          )}
        </div>

        {/* ---- footer ---- */}
        <footer className="border-t border-hairline px-4 py-2 text-center">
          <p className="text-xs text-slate-light">
            This page was retrieved by analyzing its visual content
          </p>
        </footer>
      </section>
    </div>
  );
}

