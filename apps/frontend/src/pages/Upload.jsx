import { useEffect, useRef, useState } from "react";
import {
  deleteDocument,
  getDocuments,
  reindexDocument,
  uploadDocument,
} from "../lib/apiClient";
import { useAuth } from "../lib/AuthContext";
import PdfPreview from "../components/documents/PdfPreview";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";


export default function Upload() {
  const { user } = useAuth();
  const canUpload = Boolean(user?.is_owner || user?.permissions?.includes("documents:upload"));
  const canDelete = Boolean(user?.is_owner || user?.permissions?.includes("documents:delete"));
  const fileInput = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [deletingIds, setDeletingIds] = useState([]);
  const [deleteError, setDeleteError] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let active = true;

    async function refreshDocuments() {
      try {
        const result = await getDocuments();
        if (active) {
          setUploads(result.documents.map((document) => ({
            id: document.id,
            filename: document.filename,
            fileType: document.file_type,
            previewAvailable: document.preview_available,
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
    if (!window.confirm(`Delete "${document.filename}"?`)) return;
    setDeletingIds([...deletingIds, document.id]);
    setDeleteError("");
    try {
      await deleteDocument(document.id);
      setUploads((current) => current.filter((u) => u.id !== document.id));
    } catch (err) {
      setDeleteError(err.message || "Delete failed");
    } finally {
      setDeletingIds(deletingIds.filter((id) => id !== document.id));
    }
  }

  async function handleUpload(event) {
    const files = event.target.files;
    if (!files.length) return;
    setUploading(true);
    setLoadError("");
    try {
      const formData = new FormData();
      formData.append("file", files[0]);
      await uploadDocument(formData);
      fileInput.current.value = "";
    } catch (err) {
      setLoadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    const files = event.dataTransfer.files;
    if (files.length) handleUpload({ target: { files } });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Upload documents</h1>
        <p className="text-sm text-slate">
          Upload a PDF, DOCX, XLSX, or TXT file. It will be indexed and made
          searchable for your role.
        </p>
      </div>
      <Card className="p-6 border-2 border-dashed border-hairline rounded-xl">
        <label
          className="block cursor-pointer"
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.xlsx,.txt"
            className="sr-only"
            onChange={handleUpload}
          />
          <div className="flex flex-col items-center gap-2 pt-8 pb-12">
            {dragging ? (
              <p className="text-sm text-index">Drop file here</p>
            ) : (
              <p className="text-sm text-slate">Click to upload a file</p>
            )}
            <p className="text-xs text-slate">PDF, DOCX, XLSX, TXT — up to 50 MB</p>
          </div>
        </label>
        {uploading && (
          <p className="mt-2 text-sm text-slate">Uploading…</p>
        )}
        {loadError && <p role="alert" className="mt-2 text-sm text-danger">{loadError}</p>}
      </Card>

      <div>
        <h2 className="text-sm font-medium text-ink">Your documents</h2>
        {uploads.length === 0 && !loadError && (
          <p className="text-sm text-slate">No documents uploaded yet.</p>
        )}
        {uploads.map((upload) => (
          <div
            key={upload.id}
            className="flex items-center justify-between gap-3 px-4 py-3 border-b border-hairline"
          >
            <div className="flex items-center gap-3 flex-1">
              <span className="text-sm text-ink-soft truncate">{upload.filename}</span>
              <span className="ml-auto text-xs text-slate">{upload.status}</span>
            </div>
            {canDelete && (
              <button
                type="button"
                disabled={deletingIds.includes(upload.id)}
                className="text-xs font-medium text-danger hover:underline"
                onClick={() => handleDelete(upload)}
              >
                {deletingIds.includes(upload.id) ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
        ))}
      </div>

      {deleteError && <p role="alert" className="mt-2 text-sm text-danger">{deleteError}</p>}
      {preview && (
        <PdfPreview
          documentId={preview.documentId}
          filename={preview.filename}
          page={preview.page}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

