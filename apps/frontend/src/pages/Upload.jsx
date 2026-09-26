import { useState } from "react";
import { mockDocuments } from "../mocks/queryResults";
import Card from "../components/ui/Card";

const STATUS_STYLES = {
  Indexed: "bg-success/10 text-success",
  Processing: "bg-signal/10 text-signal",
  Failed: "bg-danger/10 text-danger",
};

export default function Upload() {
  const [dragging, setDragging] = useState(false);
  const [docs, setDocs] = useState(mockDocuments);

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    // Mock only — no real upload endpoint until v0.3. Just reflects
    // the dropped file(s) into the list with a "Processing" status
    // so the flow feels real for the demo.
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const newDocs = files.map((f, i) => ({
      id: `new-${Date.now()}-${i}`,
      name: f.name,
      uploadedBy: "You",
      date: new Date().toISOString().slice(0, 10),
      status: "Processing",
    }));
    setDocs((d) => [...newDocs, ...d]);
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

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg
          border-2 border-dashed px-6 py-12 text-center transition-colors
          ${dragging ? "border-index bg-index-soft" : "border-hairline bg-paper-raised"}`}
      >
        <p className="text-sm font-medium text-ink-soft">
          Drag and drop files here
        </p>
        <p className="text-xs text-slate-light">
          or click to browse (mocked — no upload endpoint yet)
        </p>
      </div>

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
            {docs.map((doc) => (
              <tr key={doc.id} className="border-b border-hairline last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                  {doc.name}
                </td>
                <td className="px-4 py-3 text-slate">{doc.uploadedBy}</td>
                <td className="px-4 py-3 text-slate">{doc.date}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[doc.status]}`}
                  >
                    {doc.status}
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
