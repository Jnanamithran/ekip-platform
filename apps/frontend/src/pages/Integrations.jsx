import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import {
  disconnectDrive,
  getDriveConnection,
  getDriveConnectUrl,
  getDriveFiles,
  getDriveFolders,
  getOrganizationRoles,
  importDriveFiles,
} from "../lib/apiClient";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

const MAX_FILES_PER_IMPORT = 5;

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

function RoleSelector({ filename, selected, onChange, roles, ownRoleId, canManageAccess }) {
  function toggle(roleId) {
    const next = selected.includes(roleId)
      ? selected.filter((id) => id !== roleId)
      : [...selected, roleId];
    onChange(next);
  }

  return (
    <div className="mt-2 rounded-md border border-hairline bg-paper p-3">
      <p className="mb-2 text-sm font-medium text-ink-soft">
        Who can search &ldquo;{filename}&rdquo;?
      </p>
      <div className="flex flex-wrap gap-3">
        {roles.map((role) => (
          <label key={role.id} className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={selected.includes(role.id)}
              disabled={!canManageAccess || role.id === ownRoleId}
              onChange={() => toggle(role.id)}
              className="h-4 w-4 rounded accent-index"
            />
            {role.name}
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
  const [driveFolders, setDriveFolders] = useState([]);
  const [folderStack, setFolderStack] = useState([]);
  const [filePageToken, setFilePageToken] = useState(null);
  const [folderPageToken, setFolderPageToken] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState({});
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [fileRoles, setFileRoles] = useState({});
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState([]);
  const [error, setError] = useState(() => {
    const status = searchParams.get("error");
    return status
      ? status === "access_denied"
        ? "Google Drive connection was not granted."
        : "Google Drive connection failed. Please try again."
      : "";
  });
  const [notice, setNotice] = useState(() =>
    searchParams.get("connected") === "google" ? "Google Drive connected." : ""
  );
  const [connecting, setConnecting] = useState(false);

  const loadItems = useCallback(async (parentId, filePage, folderPage) => {
    setLoadingFiles(true);
    setError("");
    try {
      const [filesResult, foldersResult] = await Promise.all([
        filePage !== undefined || folderPage === undefined
          ? getDriveFiles(parentId, filePage)
          : Promise.resolve(null),
        folderPage !== undefined || filePage === undefined
          ? getDriveFolders(parentId, folderPage)
          : Promise.resolve(null),
      ]);
      if (filesResult) {
        setDriveFiles((previous) => filePage
          ? [...previous, ...(filesResult.files ?? [])]
          : filesResult.files ?? []);
        setFilePageToken(filesResult.next_page_token ?? null);
      }
      if (foldersResult) {
        setDriveFolders((previous) => folderPage
          ? [...previous, ...(foldersResult.folders ?? [])]
          : foldersResult.folders ?? []);
        setFolderPageToken(foldersResult.next_page_token ?? null);
      }
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
      setSearchParams({}, { replace: true });
    }
    getDriveConnection()
      .then(async (res) => {
        if (!active) return;
        const isConnected = Boolean(res.connected);
        setConnected(isConnected);
        if (isConnected) {
          const roleRequest = user?.is_owner ||
            user?.permissions?.includes("documents:manage_access")
            ? getOrganizationRoles().then((result) => setRoles(result.roles ?? []))
            : Promise.resolve(setRoles([{
              id: user.role_id,
              name: user.role,
              is_owner: user.is_owner,
            }]));
          await Promise.all([
            loadItems(null),
            roleRequest,
          ]);
        }
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
  }, [loadItems, searchParams, setSearchParams, user]);

  const canManageAccess =
    Boolean(user?.is_owner) || user?.permissions?.includes("documents:manage_access");
  const ownRoleMissing = Object.entries(selectedFiles).some(
    ([fileId, selected]) => selected &&
      !(fileRoles[fileId] ?? [user?.role_id]).includes(user?.role_id)
  );
  const emptyRoles = Object.entries(selectedFiles).some(
    ([fileId, selected]) => selected &&
      !(fileRoles[fileId] ?? [user?.role_id]).length
  );
  const selectedEntries = Object.entries(selectedFiles).filter(([, selected]) => selected);
  const importDisabled =
    importing || selectedEntries.length === 0 || selectedEntries.length > MAX_FILES_PER_IMPORT ||
    emptyRoles || ownRoleMissing;

  function selectionDefault() {
    return [user.role_id];
  }

  function toggleSelection(item) {
    setSelectedFiles((previous) => ({ ...previous, [item.id]: !previous[item.id] }));
    if (item.is_folder) {
      setSelectedFolderIds((previous) => previous.includes(item.id)
        ? previous.filter((id) => id !== item.id)
        : [...previous, item.id]);
    }
    setFileRoles((previous) =>
      previous[item.id] ? previous : { ...previous, [item.id]: selectionDefault() }
    );
  }

  function openFolder(folder) {
    setFolderStack((previous) => [...previous, folder]);
    setDriveFiles([]);
    setDriveFolders([]);
    loadItems(folder.id);
  }

  function navigateToFolder(index) {
    const nextStack = folderStack.slice(0, index + 1);
    const parentId = nextStack.length ? nextStack[nextStack.length - 1].id : null;
    setFolderStack(nextStack);
    setDriveFiles([]);
    setDriveFolders([]);
    loadItems(parentId);
  }

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
      setDriveFolders([]);
      setFolderStack([]);
      setFilePageToken(null);
      setFolderPageToken(null);
      setSelectedFiles({});
      setSelectedFolderIds([]);
      setFileRoles({});
      setImportResults([]);
      setNotice("Google Drive disconnected.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function importSelected() {
    const files = selectedEntries.map(([fileId]) => ({
      file_id: fileId,
      is_folder: selectedFolderIds.includes(fileId),
      allowed_role_ids: fileRoles[fileId] ?? [user.role_id],
    }));

    if (!files.length || importDisabled) return;
    setImporting(true);
    setError("");
    setNotice("");
    const allResults = [];
    try {
      const res = await importDriveFiles(files);
      allResults.push(...(res.results ?? []));
      setImportResults((prev) => [...allResults, ...prev]);
      setSelectedFiles({});
      setSelectedFolderIds([]);
      setFileRoles({});
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
        {!connected && !user?.is_owner && !user?.permissions?.includes("drive:connect") && (
          <p className="mt-2 text-sm text-slate">
            A role with Drive connection permission must connect Google Drive before you can import.
          </p>
        )}
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
          {!connected && (user?.is_owner || user?.permissions?.includes("drive:connect")) ? (
            <Button onClick={connectDrive} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect Google Drive"}
            </Button>
          ) : connected && (
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
            <p className="mb-4 rounded-md border border-hairline bg-paper-raised p-3 text-xs text-slate">
              EKIP requests read-only access to files in your Google Drive. Imports are limited to
              files and folders you select here, but Google’s authorization scope itself is broader
              than those selections. You can disconnect EKIP or revoke access in your Google Account.
            </p>
            <h3 className="mb-3 font-medium text-ink">Browse and select Drive items</h3>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                className="text-index hover:underline"
                onClick={() => navigateToFolder(-1)}
              >
                My Drive
              </button>
              {folderStack.map((folder, index) => (
                <span key={folder.id} className="flex items-center gap-2">
                  <span className="text-slate">/</span>
                  <button
                    type="button"
                    className="text-index hover:underline"
                    onClick={() => navigateToFolder(index)}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </div>
            {driveFiles.length + driveFolders.length > 0 ? (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {[...driveFolders.map((folder) => ({ ...folder, is_folder: true })), ...driveFiles].map((item) => {
                  const checked = Boolean(selectedFiles[item.id]);
                  const selectedRoles = fileRoles[item.id] ?? [user.role_id];
                  return (
                    <div key={item.id} className="rounded-md border border-hairline p-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelection(item)}
                          aria-label={`Select ${item.name}`}
                          className="h-4 w-4 rounded accent-index"
                        />
                        <span className="truncate text-sm font-medium text-ink">
                          {item.is_folder ? "📁 " : ""}{item.name}
                        </span>
                        {item.is_folder && (
                          <button
                            type="button"
                            className="text-xs text-index hover:underline"
                            onClick={() => openFolder(item)}
                          >
                            Open
                          </button>
                        )}
                        <span className="ml-auto shrink-0 text-xs text-slate-light">
                          {[formatFileSize(item.size), formatModifiedTime(item.modifiedTime)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>

                      {checked && (
                        <RoleSelector
                          filename={item.name}
                          selected={selectedRoles}
                          roles={roles}
                          ownRoleId={user.role_id}
                          canManageAccess={canManageAccess}
                          onChange={(next) =>
                            setFileRoles((prev) => ({ ...prev, [item.id]: next }))
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
                  No supported files or folders found here. Supported files: PDF, DOCX, XLSX, TXT.
                </p>
              )
            )}

            {folderPageToken && (
              <Button
                variant="secondary"
                className="mt-3 w-full"
                disabled={loadingFiles}
                onClick={() => loadItems(
                  folderStack.at(-1)?.id ?? null,
                  undefined,
                  folderPageToken
                )}
              >
                {loadingFiles ? "Loading…" : "Load more folders"}
              </Button>
            )}
            {filePageToken && (
              <Button
                variant="secondary"
                className="mt-3 w-full"
                disabled={loadingFiles}
                onClick={() => loadItems(
                  folderStack.at(-1)?.id ?? null,
                  filePageToken,
                  undefined
                )}
              >
                {loadingFiles ? "Loading…" : "Load more"}
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
                Each selection must include your own role ({user?.role}).
              </p>
            )}
            {selectedEntries.length > MAX_FILES_PER_IMPORT && (
              <p role="alert" className="mt-2 text-xs text-danger">
                Select no more than {MAX_FILES_PER_IMPORT} files or folders per import.
              </p>
            )}
            {loadingFiles && driveFiles.length + driveFolders.length === 0 && (
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
