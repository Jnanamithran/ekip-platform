import { useEffect, useState } from "react";
import { getExtractedDocumentPreview, getPdfPreview } from "../../lib/apiClient";

export default function DocumentPreview({ documentId, filename, fileType, onClose }) {
  const [preview, setPreview] = useState(null);
  const isPdf = fileType?.toLowerCase() === "pdf";

  useEffect(() => {
    let active = true;
    let objectUrl;

    const loadPreview = isPdf
      ? getPdfPreview(documentId).then((file) => {
          objectUrl = URL.createObjectURL(file);
          return { url: objectUrl };
        })
      : getExtractedDocumentPreview(documentId);

    loadPreview
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((error) => {
        if (active) setPreview({ error: error.message });
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, isPdf]);

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
        aria-label={`Document preview: ${filename}`}
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-paper"
      >
        <header className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-ink">{filename}</h2>
            <p className="text-xs uppercase text-slate">{fileType} preview</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document preview"
            className="rounded px-3 py-1 text-lg text-slate hover:bg-paper-raised hover:text-ink"
          >
            ×
          </button>
        </header>
        {preview?.error ? (
          <p role="alert" className="m-auto max-w-lg p-6 text-center text-sm text-danger">
            {preview.error}
          </p>
        ) : isPdf && preview?.url ? (
          <iframe
            title={`PDF preview: ${filename}`}
            src={preview.url}
            className="h-full w-full flex-1 bg-slate-100"
          />
        ) : preview?.pages ? (
          <div className="flex-1 overflow-auto p-5">
            {preview.warning && (
              <p className="mb-4 rounded border border-hairline bg-paper-raised p-3 text-sm text-slate">
                {preview.warning}
              </p>
            )}
            {preview.pages.length ? (
              <div className="mx-auto flex max-w-4xl flex-col gap-4">
                {preview.pages.map((page, index) => (
                  <section
                    key={`${page.page_num}-${index}`}
                    className="rounded-md border border-hairline bg-white p-4"
                  >
                    {preview.pages.length > 1 && (
                      <h3 className="mb-2 text-xs font-semibold text-slate">
                        {fileType?.toLowerCase() === "xlsx" ? "Row" : "Section"} {page.page_num}
                      </h3>
                    )}
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink">
                      {page.text}
                    </pre>
                  </section>
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-slate">This document has no previewable text.</p>
            )}
          </div>
        ) : (
          <p role="status" className="m-auto p-6 text-sm text-slate">
            Loading document preview…
          </p>
        )}
      </section>
    </div>
  );
}
