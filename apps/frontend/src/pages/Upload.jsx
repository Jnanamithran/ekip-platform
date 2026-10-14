import { useEffect, useRef, useState } from "react";
import { deleteDocument, getDocuments, uploadDocument } from "../lib/apiClient";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

export default function Upload() {
  const fileInput = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [deletingIds, setDeletingIds] = useState([]);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let active = true;

    async function refreshDocuments() {
      try {
        const result = await getDocuments();
        if (active) {
          setUploads(result.documents.map((document) => ({
            id: document.id,
            filename: document.filename,
            processing: document.status === "Processing",
            status: document.status === "Processing"
              ? document.stage || "Processing..."
              : document.status === "Failed" || document.status === "Timed out"
                ? `${document.status}: ${document.stage}`
                : document.status === "Indexed"
                  ? `Indexed (${document.chunk_count} chunks)`
                  : document.status,
            progress: document.progress,
          })));
          setLoadError(result.warning || "");
        }
      } catch (err) {
        if (active) setLoadError(err.message);
      }
    }

    refreshDocuments();
    const intervalId = window.setInterval(refreshDocuments, 5000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  async function handleDelete(document) {
    if (!window.confirm(`Delete "${document.filename}" and its indexed content? This cannot be undone.`)) {
      return;
    }

    setDeletingIds((current) => [...current, document.id]);
    setDeleteError("");
    try {
      await deleteDocument(document.id);
      setUploads((current) => current.filter((item) => item.id !== document.id));
    } catch (err) {
      setDeleteError(`Could not delete ${document.filename}: ${err.message}`);
    } finally {
      setDeletingIds((current) => current.filter((id) => id !== document.id));
    }
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length || uploading) return;

    setUploading(true);
    for (const file of files) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((current) => [
        { id, filename: file.name, status: "Uploading 0%", processing: false, progress: 0 },
        ...current,
      ]);

      try {
        const result = await uploadDocument(file, (percent) => {
          setUploads((current) =>
            current.map((upload) =>
              upload.id === id
                ? {
                  ...upload,
                  status: percent >= 100 ? "Processing..." : `Uploading ${percent}%`,
                  processing: percent >= 100,
                  progress: percent >= 100 ? 5 : percent,
                }
                : upload
            )
          );
        });
        setUploads((current) =>
          current.map((upload) =>
            upload.id === id
              ? {
                ...upload,
                filename: result.filename,
                processing: false,
                status: result.status === "Indexed"
                  ? `Indexed (${result.chunk_count} chunks)`
                  : result.status || "Uploaded",
                progress: 100,
              }
              : upload
          )
        );
      } catch (err) {
        setUploads((current) =>
          current.map((upload) =>
            upload.id === id
              ? { ...upload, status: `Failed: ${err.message}`, processing: false }
              : upload
          )
        );
      }
    }
    setUploading(false);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Upload documents</h1>
        <p className="text-sm text-slate">
          Add PDF, DOCX, XLSX, or TXT documents to your workspace's knowledge base.
        </p>
        {loadError && <p role="alert" className="mt-2 text-sm text-danger">{loadError}</p>}
        {deleteError && <p role="alert" className="mt-2 text-sm text-danger">{deleteError}</p>}
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg
          border-2 border-dashed px-6 py-12 text-center transition-colors
          ${dragging ? "border-index bg-index-soft" : "border-hairline bg-paper-raised"}`}
      >
        <p className="text-sm font-medium text-ink-soft">
          Drag and drop files here
        </p>
        <Button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          Choose files
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.txt"
          className="sr-only"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {uploads.length > 0 && (
        <Card className="divide-y divide-hairline">
          {uploads.map((upload) => (
            <div
              key={upload.id}
              className="flex flex-col gap-2 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="truncate font-mono text-xs text-ink-soft">
                  {upload.filename}
                </span>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate">{upload.status}</span>
                  {upload.processing && Number.isInteger(upload.progress) && (
                    <span className="text-xs text-slate">{upload.progress}%</span>
                  )}
                  <button
                    type="button"
                    aria-label={`Delete ${upload.filename}`}
                    title={
                      upload.processing || upload.status.startsWith("Uploading")
                        ? "Wait for upload and processing to finish"
                        : "Delete document"
                    }
                    disabled={
                      upload.processing ||
                      upload.status.startsWith("Uploading") ||
                      deletingIds.includes(upload.id)
                    }
                    onClick={() => handleDelete(upload)}
                    className="rounded px-2 py-1 text-lg leading-none text-slate hover:bg-danger/10
                      hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {deletingIds.includes(upload.id) ? "…" : "×"}
                  </button>
                </div>
              </div>
              {Number.isInteger(upload.progress) && upload.processing && (
                <div className="h-1 w-full overflow-hidden rounded bg-hairline">
                  <div
                    className="h-full bg-index transition-all"
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      {uploads.length === 0 && !loadError && (
        <p className="text-sm text-slate">No documents have been uploaded to this department yet.</p>
      )}
    </div>
  );
}
