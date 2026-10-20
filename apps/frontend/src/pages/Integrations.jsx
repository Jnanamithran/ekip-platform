import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import {
  disconnectDrive,
  getDriveConnection,
  getDriveConnectUrl,
  getDriveFiles,
  importDriveFiles,
} from "../lib/apiClient";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

const ROLE_OPTIONS = ["Admin", "Manager", "Employee", "Intern"];
// The backend caps each import call at 5 files — larger selections are
// sent as sequential batches so nothing is silently dropped.
const MAX_FILES_PER_IMPORT = 5;

function defaultRolesFor(role) {
  return role && ROLE_OPTIONS.includes(role) ? [role] : [...ROLE_OPTIONS];
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModifiedTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function RoleSelector({ filename, selected, onChange }) {
  function toggle(role) {
    const next = selected.includes(role)
      ? selected.filter((r) => r !== role)
      : [...selected, role];
    onChange(next);
  }

  return (
    <div className="mt-2 rounded-md border border-hairline bg-paper p-3">
      <p className="mb-2 text-sm font-medium text-ink-soft">
        Who can search &ldquo;{filename}&rdquo;?
      </p>
      <div className="flex flex-wrap gap-3">
        {ROLE_OPTIONS.map((role) => (
          <label key={role} className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={selected.includes(role)}
              onChange={() => toggle(role)}
              className="h-4 w-4 rounded accent-index"
            />
            {role}
          </label>
        ))}
      </div>
      {selected.length === 0 && (
        <p role="alert" className="mt-1 text-xs text-danger">
          Select at least one role.
        </p>
      )}
    </div>
  );
}

export default function Integrations() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [driveFiles, setDriveFiles] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState({});
  const [fileRoles, setFileRoles] = useState({});
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connecting, setConnecting] = useState(false);

  const loadFiles = useCallback(async (pageToken) => {
    setLoadingFiles(true);
    setError("");
    try {
      const res = await getDriveFiles(pageToken);
      const files = res.files ?? [];
      setDriveFiles((prev) => (pageToken ? [...prev, ...files] : files));
      setNextPageToken(res.next_page_token ?? null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    // The OAuth callback lands back here with ?connected=google (or an
    // error). Consume the param once so a reload doesn't replay the notice.
    const oauthStatus = searchParams.get("connected");
    const oauthError = searchParams.get("error");
    if (oauthStatus || oauthError) {
      if (active) {
        if (oauthStatus === "google") {
          setNotice("Google Drive connected.");
        } else {
          setError(
            oauthError === "access_denied"
              ? "Google Drive connection was not granted."
              : "Google Drive connection failed. Please try again."
          );
        }
        setSearchParams({}, { replace: true });
      }
    }
    getDriveConnection()
      .then((res) => {
        if (!active) return;
        const isConnected = Boolean(res.connected);
        setConnected(isConnected);
        if (isConnected) loadFiles();
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [loadFiles, searchParams, setSearchParams]);

  async function connectDrive() {
    setConnecting(true);
    setError("");
    try {
      const res = await getDriveConnectUrl();
      window.location.href = res.url; // redirect to Google OAuth
    } catch (err) {
      setError(err.message);
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect Google Drive? Imported documents stay searchable.")) return;
    setError("");
    setNotice("");
    try {
      await disconnectDrive();
      setConnected(false);
      setDriveFiles([]);
      setNextPageToken(null);
      setSelectedFiles({});
      setFileRoles({});
      setImportResults([]);
      setNotice("Google Drive disconnected.");
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleFile(fileId) {
    setSelectedFiles((prev) => ({ ...prev, [fileId]: !prev[fileId] }));
    setFileRoles((prev) =>
      prev[fileId] ? prev : { ...prev, [fileId]: defaultRolesFor(user?.role) }
    );
  }

  const selectedEntries = Object.entries(selectedFiles).filter(([, selected]) => selected);

  // Backend rejects roles that exclude the importer — keep their own role
  // checked so a valid selection can never 400.
  const ownRoleMissing = selectedEntries.some(
    ([fileId]) => !(fileRoles[fileId] ?? defaultRolesFor(user?.role)).includes(user?.role)
  );
  const emptyRoles = selectedEntries.some(
    ([fileId]) => (fileRoles[fileId] ?? defaultRolesFor(user?.role)).length === 0
  );
  const importDisabled =
    importing || selectedEntries.length === 0 || emptyRoles || ownRoleMissing;

  async function importSelected() {
    const files = selectedEntries.map(([fileId]) => ({
      file_id: fileId,
      allowed_roles: fileRoles[fileId] ?? defaultRolesFor(user?.role),
    }));
    // filename is display-only: the backend reads name/type from Drive.

    if (!files.length || importDisabled) return;
    setImporting(true);
    setError("");
    setNotice("");
    const allResults = [];
    try {
      for (let i = 0; i < files.length; i += MAX_FILES_PER_IMPORT) {
        const batch = files.slice(i, i + MAX_FILES_PER_IMPORT);
        // Sequential batches: each file can take minutes server-side.
        // eslint-disable-next-line no-await-in-loop
        const res = await importDriveFiles(batch);
        allResults.push(...(res.results ?? []));
      }
      setImportResults((prev) => [...allResults, ...prev]);
      setSelectedFiles({});
      const ok = allResults.filter((r) => r.status === "success").length;
      const total = allResults.length;
      setNotice(`Imported ${ok} of ${total} file${total === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  if (checking) {
    return <p className="text-sm text-slate">Checking Google Drive connection…</p>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Integrations</h1>
        <p className="text-sm text-slate">
          Connect Google Drive and import documents with per-file access control.
        </p>
      </div>

      {notice && (
        <p role="status" className="rounded-md border border-hairline bg-paper-raised px-4 py-2 text-sm text-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-hairline bg-paper-raised px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-medium text-ink">Google Drive</h2>
            <p className="text-sm text-slate">
              {connected ? "Connected" : "Not connected"}
            </p>
          </div>
          {!connected ? (
            <Button onClick={connectDrive} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect Google Drive"}
            </Button>
          ) : (
            <button
              type="button"
              onClick={handleDisconnect}
              className="text-sm text-danger hover:underline"
            >
              Disconnect
            </button>
          )}
        </div>

        {connected && (
          <div>
            <h3 className="mb-3 font-medium text-ink">Your Drive files</h3>
            {driveFiles.length > 0 ? (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {driveFiles.map((file) => {
                  const checked = Boolean(selectedFiles[file.id]);
                  const roles = fileRoles[file.id] ?? defaultRolesFor(user?.role);
                  return (
                    <div key={file.id} className="rounded-md border border-hairline p-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFile(file.id)}
                          aria-label={`Select ${file.name}`}
                          className="h-4 w-4 rounded accent-index"
                        />
                        <span className="truncate text-sm font-medium text-ink">{file.name}</span>
                        <span className="ml-auto shrink-0 text-xs text-slate-light">
                          {[formatFileSize(file.size), formatModifiedTime(file.modifiedTime)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>

                      {checked && (
                        <RoleSelector
                          filename={file.name}
                          selected={roles}
                          onChange={(next) =>
                            setFileRoles((prev) => ({ ...prev, [file.id]: next }))
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              !loadingFiles && (
                <p className="text-sm text-slate">
                  No importable files found (PDF, DOCX, XLSX, TXT).
                </p>
              )
            )}

            {nextPageToken && (
              <Button
                variant="secondary"
                className="mt-3 w-full"
                disabled={loadingFiles}
                onClick={() => loadFiles(nextPageToken)}
              >
                {loadingFiles ? "Loading…" : "Load more files"}
              </Button>
            )}

            <Button
              onClick={importSelected}
              disabled={importDisabled}
              className="mt-4 w-full"
            >
              {importing
                ? "Importing…"
                : `Import selected (${selectedEntries.length})`}
            </Button>
            {ownRoleMissing && selectedEntries.length > 0 && (
              <p role="alert" className="mt-2 text-xs text-danger">
                Each file must include your own role ({user?.role}).
              </p>
            )}
            {loadingFiles && driveFiles.length === 0 && (
              <p className="mt-2 text-sm text-slate">Loading Drive files…</p>
            )}
          </div>
        )}
      </Card>

      {importResults.length > 0 && (
        <Card className="divide-y divide-hairline">
          <div className="border-b border-hairline px-4 py-3">
            <h2 className="text-sm font-medium text-ink">Import results</h2>
          </div>
          {importResults.map((result, i) => (
            <div
              key={`${result.file_id}-${i}`}
              className={`flex items-center gap-2 px-4 py-2 text-sm ${
                result.status === "success" ? "text-success" : "text-danger"
              }`}
            >
              <span aria-hidden="true">{result.status === "success" ? "✓" : "✕"}</span>
              <span className="truncate font-medium">
                {result.filename ?? result.file_id}
              </span>
              <span className="ml-auto shrink-0 text-xs">
                {result.status === "success"
                  ? `${result.chunk_count ?? 0} chunks created`
                  : result.error ?? "Import failed"}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
