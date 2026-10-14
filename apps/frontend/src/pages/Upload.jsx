import { useEffect, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import Card from "../components/ui/Card";

const STATUS_STYLES = {
  Indexed: "bg-success/10 text-success",
  Processing: "bg-signal/10 text-signal",
  Failed: "bg-danger/10 text-danger",
};

export default function Upload() {
  const [dragging, setDragging] = useState(false);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    apiFetch("/admin/documents")
      .then((data) => setDocs(data.documents ?? []))
      .catch(() => {});
  }, []);

  async function uploadFiles(files) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f));

      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/documents/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();

      // Refresh the document list after upload
      const refreshed = await apiFetch("/admin/documents").catch(() => null);
      if (refreshed?.documents) {
        setDocs(refreshed.documents);
      } else if (data.documents) {
        setDocs((d) => [...data.documents, ...d]);
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    uploadFiles(files);
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    uploadFiles(files);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Upload documents</h1>
        <p className="text-sm text-slate">
          Add documents to your workspace's knowledge base. Supported: PDF,
          DOCX, XLSX, PPTX.
        </p>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg
          border-2 border-dashed px-6 py-12 text-center transition-colors
          ${dragging ? "border-index bg-index-soft" : "border-hairline bg-paper-raised"}`}
      >
        <p className="text-sm font-medium text-ink-soft">
          {uploading ? "Uploading…" : "Drag and drop files here"}
        </p>
        <p className="text-xs text-slate-light">or click to browse</p>
        <input
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.pptx"
          onChange={handleFileSelect}
          className="hidden"
        />
      </label>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-slate-light">
              <th className="px-4 py-3 font-medium">Document</th>
              <th className="px-4 py-3 font-medium">Uploaded by</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate">
                  No documents uploaded yet.
                </td>
              </tr>
            )}
            {docs.map((doc) => (
              <tr key={doc.id} className="border-b border-hairline last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                  {doc.filename ?? doc.name}
                </td>
                <td className="px-4 py-3 text-slate">{doc.uploadedBy ?? doc.uploaded_by}</td>
                <td className="px-4 py-3 text-slate">
                  {doc.date ?? (doc.created_at ? new Date(doc.created_at).toISOString().slice(0, 10) : "—")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[doc.status] ?? "bg-slate/10 text-slate"}`}
                  >
                    {doc.status ?? "Unknown"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
