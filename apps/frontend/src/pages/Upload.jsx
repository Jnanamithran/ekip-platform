import { useRef, useState } from "react";
import { uploadDocument } from "../lib/apiClient";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

export default function Upload() {
  const fileInput = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length || uploading) return;

    setUploading(true);
    for (const file of files) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((current) => [
        { id, filename: file.name, status: "Uploading" },
        ...current,
      ]);

      try {
        const result = await uploadDocument(file);
        setUploads((current) =>
          current.map((upload) =>
            upload.id === id
              ? { ...upload, filename: result.filename, status: result.status || "Uploaded" }
              : upload
          )
        );
      } catch (err) {
        setUploads((current) =>
          current.map((upload) =>
            upload.id === id ? { ...upload, status: `Failed: ${err.message}` } : upload
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
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="truncate font-mono text-xs text-ink-soft">
                {upload.filename}
              </span>
              <span className="shrink-0 text-xs text-slate">{upload.status}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
