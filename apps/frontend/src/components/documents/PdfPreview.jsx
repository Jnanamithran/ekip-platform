import { useEffect, useState } from "react";
import { getPdfPreview } from "../../lib/apiClient";

export default function PdfPreview({ documentId, filename, page = 1, onClose }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let active = true;
    let objectUrl;

    getPdfPreview(documentId)
      .then((file) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(file);
        setPreview({ documentId, url: objectUrl });
      })
      .catch((loadError) => {
        if (active) setPreview({ documentId, error: loadError.message });
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const targetPage = Number.isInteger(page) && page > 0 ? page : 1;
  const currentPreview = preview?.documentId === documentId ? preview : null;

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
        aria-label={`PDF preview: ${filename}`}
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-paper"
      >
        <header className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-ink">{filename}</h2>
            <p className="text-xs text-slate">Page {targetPage}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PDF preview"
            className="rounded px-3 py-1 text-lg text-slate hover:bg-paper-raised hover:text-ink"
          >
            ×
          </button>
        </header>
        {currentPreview?.error ? (
          <p role="alert" className="m-auto max-w-lg p-6 text-center text-sm text-danger">
            {currentPreview.error}
          </p>
        ) : currentPreview?.url ? (
          <iframe
            title={`PDF preview: ${filename}, page ${targetPage}`}
            src={`${currentPreview.url}#page=${targetPage}`}
            className="h-full w-full flex-1 bg-slate-100"
          />
        ) : (
          <p role="status" className="m-auto p-6 text-sm text-slate">Loading PDF preview…</p>
        )}
      </section>
    </div>
  );
}
