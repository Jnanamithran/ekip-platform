import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteDocument,
  getDepartments,
  getDocuments,
  getOrganizationRoles,
  reindexDocument,
  updateDocumentAccess,
  uploadDocument,
} from "../lib/apiClient";
import { useAuth } from "../lib/AuthContext";
import DocumentPreview from "../components/documents/DocumentPreview";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

export default function Upload() {
  const { user } = useAuth();
  const canUpload = Boolean(user?.is_owner || user?.permissions?.includes("documents:upload"));
  const canDelete = Boolean(user?.is_owner || user?.permissions?.includes("documents:delete"));
  const canReindex = Boolean(user?.is_owner || user?.permissions?.includes("documents:reindex"));
  const canManageAccess = Boolean(
    user?.is_owner || user?.permissions?.includes("documents:manage_access")
  );
  const fileInput = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingIds, setDeletingIds] = useState([]);
  const [reindexingIds, setReindexingIds] = useState([]);
  const [preview, setPreview] = useState(null);
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState(
    user?.role_id ? [user.role_id] : []
  );
  const [accessEdit, setAccessEdit] = useState(null);
  const [accessRoleIds, setAccessRoleIds] = useState([]);
  const [accessDepartmentId, setAccessDepartmentId] = useState("");
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessError, setAccessError] = useState("");

  // Department selection state
  const [departments, setDepartments] = useState([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [loadingDepts, setLoadingDepts] = useState(true);

  const [notice, setNotice] = useState("");
  const [reindexError, setReindexError] = useState("");

  const refreshDocuments = useCallback(async () => {
    try {
      const result = await getDocuments();
      setUploads(
        result.documents.map((doc) => ({
          id: doc.id,
          filename: doc.filename,
          fileType: doc.file_type,
          departmentId: doc.department_id,
          departmentName: doc.department_name || doc.department?.name || "",
          allowedRoleIds: doc.allowed_role_ids || [],
          previewAvailable: doc.preview_available,
          processing: doc.status === "Processing",
          status:
            doc.status === "Processing"
              ? doc.stage || "Processing..."
              : doc.status === "Failed" || doc.status === "Timed out"
              ? `${doc.status}: ${doc.stage}`
              : doc.status === "Indexed"
              ? `Indexed (${doc.chunk_count} chunks)`
              : doc.status,
          progress: doc.progress,
        }))
      );
      setLoadError(result.warning || "");
    } catch (err) {
      setLoadError(err.message || "Failed to load documents");
    }
  }, []);

  useEffect(() => {
    if (!canManageAccess) return;

    let active = true;
    setRolesLoading(true);
    setRolesError("");
    getOrganizationRoles()
      .then((result) => {
        if (!active) return;
        const availableRoles = (result.roles || []).filter(
          (role) => !role.scope_review_required
        );
        setRoles(availableRoles);
        if (!availableRoles.length) {
          setRolesError("No organization roles are available. Ask an administrator to configure roles before uploading.");
          setSelectedRoleIds([]);
          return;
        }
        setSelectedRoleIds((current) => {
          const stillValid = current.filter((id) => availableRoles.some((role) => role.id === id));
          if (stillValid.length) return stillValid;
          return user?.role_id && availableRoles.some((role) => role.id === user.role_id)
            ? [user.role_id]
            : [];
        });
      })
      .catch((error) => {
        if (active) setRolesError(error.message || "Could not load organization roles.");
      })
      .finally(() => {
        if (active) setRolesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canManageAccess, user?.role_id]);

  const rolesForSelectedDepartment = roles.filter(
    (role) => role.scope !== "department" || role.department_id === selectedDeptId
  );
  const rolesForAccessDepartment = roles.filter(
    (role) =>
      role.scope !== "department" || role.department_id === accessDepartmentId
  );
  const selectedScopedRoleIds = [
    ...new Set([
      ...selectedRoleIds.filter((id) =>
        rolesForSelectedDepartment.some((role) => role.id === id)
      ),
      ...rolesForSelectedDepartment
        .filter((role) => role.is_owner)
        .map((role) => role.id),
    ]),
  ];
  const loadDepartments = useCallback(async () => {
    setLoadingDepts(true);
    try {
      const deptRes = await getDepartments().catch(() => ({ departments: [] }));
      const depts = deptRes.departments || [];
      setDepartments(depts);

      // Default selected department to user's assigned department or first available
      if (depts.length > 0) {
        const userDeptExists = depts.some((d) => d.id === user?.department_id);
        setSelectedDeptId((prev) => prev || (userDeptExists ? user.department_id : depts[0].id));
      }
    } catch (err) {
      console.error("Failed to load departments:", err);
    } finally {
      setLoadingDepts(false);
    }
  }, [user?.department_id]);

  useEffect(() => {
    loadDepartments();
    refreshDocuments();
    const intervalId = window.setInterval(refreshDocuments, 5000);
    return () => window.clearInterval(intervalId);
  }, [loadDepartments, refreshDocuments]);

  async function uploadFiles(files, roleIds) {
    if (!files.length) return;

    if (!selectedDeptId) {
      setLoadError("Please select a department before uploading files.");
      return;
    }
    if (!roleIds.length || (canManageAccess && rolesError)) {
      setLoadError(rolesError || "Select at least one allowed role before uploading.");
      return;
    }

    setLoadError("");
    setNotice("");
    setUploadingFiles(true);

    // Initialize queue items
    const newItems = files.map((file, idx) => ({
      key: `${file.name}-${Date.now()}-${idx}`,
      file,
      filename: file.name,
      status: "Uploading...",
      progress: 0,
      error: null,
    }));
    setUploadQueue((prev) => [...newItems, ...prev]);

    // Process files sequentially
    for (const item of newItems) {
      try {
        await uploadDocument(
          item.file,
          (pct) => {
            setUploadQueue((q) =>
              q.map((x) => (x.key === item.key ? { ...x, progress: pct } : x))
            );
          },
          roleIds,
          selectedDeptId || undefined
        );
        setUploadQueue((q) =>
          q.map((x) =>
            x.key === item.key
              ? { ...x, status: "Uploaded successfully", progress: 100 }
              : x
          )
        );
      } catch (err) {
        setUploadQueue((q) =>
          q.map((x) =>
            x.key === item.key
              ? { ...x, status: "Failed", error: err.message || "Upload failed" }
              : x
          )
        );
      }
    }

    if (fileInput.current) fileInput.current.value = "";
    setPendingFiles([]);
    await refreshDocuments();
    setUploadingFiles(false);
  }

  function handleFiles(filesList) {
    const files = Array.from(filesList);
    setPendingFiles(files);
    setLoadError("");
  }

  function handleFileInputChange(event) {
    if (event.target.files) {
      handleFiles(event.target.files);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files) {
      handleFiles(event.dataTransfer.files);
    }
  }

  async function handleDelete(document) {
    if (!window.confirm(`Delete "${document.filename}"?`)) return;
    setDeletingIds((prev) => [...prev, document.id]);
    setDeleteError("");
    try {
      await deleteDocument(document.id);
      setUploads((current) => current.filter((u) => u.id !== document.id));
    } catch (err) {
      setDeleteError(err.message || "Delete failed");
    } finally {
      setDeletingIds((prev) => prev.filter((id) => id !== document.id));
    }
  }

  async function handleReindex(document) {
    if (!window.confirm(`Reindex "${document.filename}"? Its current search index will be replaced.`)) {
      return;
    }
    setReindexError("");
    setNotice("");
    setReindexingIds((current) => [...current, document.id]);
    try {
      await reindexDocument(document.id);
      setNotice(`"${document.filename}" was reindexed successfully.`);
      await refreshDocuments();
    } catch (err) {
      setReindexError(err.message || `Failed to reindex "${document.filename}".`);
      await refreshDocuments();
    } finally {
      setReindexingIds((current) => current.filter((id) => id !== document.id));
    }
  }

  function openAccessEditor(document) {
    setAccessEdit(document);
    setAccessDepartmentId(document.departmentId);
    const allowedRoleIds = new Set(
      roles
        .filter(
          (role) =>
            role.scope !== "department" ||
            role.department_id === document.departmentId
        )
        .map((role) => role.id)
    );
    setAccessRoleIds([
      ...new Set([
        ...document.allowedRoleIds.filter((id) => allowedRoleIds.has(id)),
        ...roles
          .filter((role) => role.is_owner)
          .map((role) => role.id),
      ]),
    ]);
    setAccessError("");
  }

  async function saveDocumentAccess(event) {
    event.preventDefault();
    if (!accessEdit || !accessRoleIds.length || !accessDepartmentId) {
      setAccessError("Choose a department and at least one allowed role.");
      return;
    }
    setAccessSaving(true);
    setAccessError("");
    try {
      await updateDocumentAccess(accessEdit.id, {
        allowed_role_ids: accessRoleIds,
        department_id: accessDepartmentId,
      });
      setNotice(`Access updated for "${accessEdit.filename}".`);
      setAccessEdit(null);
      await refreshDocuments();
    } catch (error) {
      setAccessError(error.message || "Failed to update document access.");
    } finally {
      setAccessSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl text-ink">Upload documents</h1>
          <p className="text-sm text-slate">
            Upload PDF, DOCX, XLSX, or TXT documents. Documents are indexed and linked to your selected department.
          </p>
        </div>
        <label
          htmlFor="dept-select"
          className="flex min-w-56 flex-col gap-1 text-xs font-medium text-ink-soft"
        >
          Department
          {loadingDepts ? (
            <span className="py-2 text-xs font-normal text-slate">Loading departments…</span>
          ) : departments.length === 0 ? (
            <span className="py-2 text-xs font-normal text-danger">No departments found.</span>
          ) : (
            <select
              id="dept-select"
              value={selectedDeptId}
              onChange={(event) => {
                const departmentId = event.target.value;
                setSelectedDeptId(departmentId);
                const allowedRoleIds = new Set(
                  roles
                    .filter(
                      (role) =>
                        role.scope !== "department" ||
                        role.department_id === departmentId
                    )
                    .map((role) => role.id)
                );
                setSelectedRoleIds((current) =>
                  current.filter((id) => allowedRoleIds.has(id))
                );
              }}
              className="rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm font-medium text-ink focus:border-index focus:outline-none"
            >
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name} {dept.workspace?.name ? `(${dept.workspace.name})` : ""}
                </option>
              ))}
            </select>
          )}
          {selectedDeptId && departments.length > 0 && departments.find(
            (department) => department.id === selectedDeptId
          )?.description && (
            <span className="max-w-64 font-normal text-slate">
              {departments.find((department) => department.id === selectedDeptId)?.description}
            </span>
          )}
        </label>
      </div>

      {notice && (
        <div
          role="status"
          className="rounded-md border border-hairline bg-paper-raised px-4 py-3 text-sm text-success"
        >
          {notice}
        </div>
      )}
      {loadError && (
        <div
          role="alert"
          className="rounded-md border border-hairline bg-paper-raised px-4 py-3 text-sm text-danger"
        >
          {loadError}
        </div>
      )}

      {/* Upload Dropzone */}
      <Card className="p-6 border-2 border-dashed border-hairline rounded-xl">
        <label
          className="block cursor-pointer"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.txt"
            className="sr-only"
            disabled={!canUpload}
            onChange={handleFileInputChange}
          />
          <div className="flex flex-col items-center gap-2 pt-8 pb-10">
            {dragging ? (
              <p className="text-sm font-medium text-index">Drop files here to upload</p>
            ) : (
              <p className="text-sm font-medium text-ink">
                Click to browse or drop files here
              </p>
            )}
            <p className="text-xs text-slate">
              Supports multiple files: PDF, DOCX, XLSX, TXT (up to 50 MB each)
            </p>
          </div>
        </label>
        {pendingFiles.length > 0 && (
          <div className="mt-4 border-t border-hairline pt-4">
            <p className="mb-2 text-xs font-medium text-ink-soft">
              Selected files ({pendingFiles.length})
            </p>
            <ul className="mb-3 max-h-24 overflow-auto text-xs text-slate">
              {pendingFiles.map((file, index) => (
                <li key={`${file.name}-${index}`} className="truncate">{file.name}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="mb-2">
            <h3 className="text-sm font-medium text-ink">Allowed Roles</h3>
            <p className="text-xs text-slate">
              Department authorization and allowed roles are separate checks. A user needs both.
            </p>
          </div>
          {canManageAccess ? (
            rolesLoading ? (
              <p className="text-xs text-slate">Loading organization roles…</p>
            ) : rolesError ? (
              <p role="alert" className="text-xs text-danger">{rolesError}</p>
            ) : rolesForSelectedDepartment.length === 0 ? (
              <p className="text-xs text-danger">No roles are available; uploads are disabled.</p>
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Select roles that can access these documents</legend>
                <label className="flex items-center gap-2 text-xs font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={
                      rolesForSelectedDepartment.length > 0 &&
                      selectedScopedRoleIds.length === rolesForSelectedDepartment.length
                    }
                    onChange={(event) =>
                      setSelectedRoleIds(
                        event.target.checked
                          ? rolesForSelectedDepartment.map((role) => role.id)
                          : rolesForSelectedDepartment
                              .filter((role) => role.is_owner)
                              .map((role) => role.id)
                      )
                    }
                  />
                  Select all
                </label>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {rolesForSelectedDepartment.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-xs text-ink-soft">
                      <input
                        type="checkbox"
                        checked={role.is_owner || selectedScopedRoleIds.includes(role.id)}
                        disabled={role.is_owner}
                        onChange={() =>
                          setSelectedRoleIds((current) =>
                            current.includes(role.id)
                              ? current.filter((id) => id !== role.id)
                              : [...current, role.id]
                          )
                        }
                      />
                      {role.name}
                      {role.scope === "department" && (
                        <span className="text-slate">
                          {" "}({departments.find((department) => department.id === role.department_id)?.name || "Department"})
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          ) : (
            <p className="text-xs text-slate">
              These documents will be accessible only to your assigned role
              {user?.role ? ` (${user.role})` : ""}. Contact an administrator to assign additional roles.
            </p>
          )}
          <Button
            type="button"
            disabled={
              !canUpload ||
              !pendingFiles.length ||
              uploadingFiles ||
              !selectedDeptId ||
              !selectedScopedRoleIds.length ||
              (canManageAccess &&
                (rolesLoading || rolesError || !rolesForSelectedDepartment.length))
            }
            className="mt-4"
            onClick={() => uploadFiles(pendingFiles, selectedScopedRoleIds)}
          >
            {uploadingFiles
              ? "Uploading…"
              : `Upload${pendingFiles.length ? ` ${pendingFiles.length} selected file${pendingFiles.length === 1 ? "" : "s"}` : ""}`}
          </Button>
        </div>
      </Card>

      {/* Upload Queue Progress */}
      {uploadQueue.length > 0 && (
        <Card className="divide-y divide-hairline overflow-hidden">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5 bg-paper-raised/40">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Upload queue
            </h3>
            <button
              type="button"
              onClick={() => setUploadQueue([])}
              className="text-xs text-slate hover:text-ink"
            >
              Clear
            </button>
          </div>
          {uploadQueue.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
              <span className="truncate max-w-sm font-medium text-ink">{item.filename}</span>
              <div className="flex items-center gap-3">
                {item.error ? (
                  <span className="text-danger">{item.error}</span>
                ) : item.progress === 100 ? (
                  <span className="text-success font-medium">Uploaded</span>
                ) : (
                  <span className="text-slate">{item.progress}% ({item.status})</span>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Documents List */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Organization documents ({uploads.length})</h2>
        </div>

        {uploads.length === 0 && !loadError ? (
          <Card className="p-8 text-center text-sm text-slate">
            No documents uploaded yet. Upload a document to get started.
          </Card>
        ) : (
          <Card className="divide-y divide-hairline overflow-hidden">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-paper-raised/30"
              >
                <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-48">
                  <span className="text-sm font-medium text-ink truncate">
                    {upload.filename}
                  </span>
                  {upload.departmentName && (
                    <span className="rounded bg-paper-raised px-2 py-0.5 text-[11px] font-medium text-slate border border-hairline">
                      {upload.departmentName}
                    </span>
                  )}
                  <span className="rounded bg-index-soft px-1.5 py-0.2 text-[10px] uppercase font-bold text-index">
                    {upload.fileType}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate">{upload.status}</span>
                  {upload.previewAvailable && (
                    <button
                      type="button"
                      className="text-xs font-medium text-index hover:underline"
                      onClick={() =>
                        setPreview({
                          documentId: upload.id,
                          filename: upload.filename,
                          fileType: upload.fileType,
                        })
                      }
                    >
                      Preview
                    </button>
                  )}
                  {canReindex && (
                    <button
                      type="button"
                      disabled={upload.processing || reindexingIds.includes(upload.id)}
                      className="text-xs font-medium text-index hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => handleReindex(upload)}
                      title={
                        upload.processing
                          ? "This document is already processing"
                          : "Rebuild this document's search index"
                      }
                    >
                      {reindexingIds.includes(upload.id) ? "Reindexing…" : "Reindex"}
                    </button>
                  )}
                  {canManageAccess && (
                    <button
                      type="button"
                      disabled={upload.processing}
                      className="text-xs font-medium text-index hover:underline disabled:opacity-50"
                      onClick={() => openAccessEditor(upload)}
                      title="Change this document's department and allowed roles"
                    >
                      Edit access
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      disabled={deletingIds.includes(upload.id)}
                      className="text-xs font-medium text-danger hover:underline disabled:opacity-50"
                      onClick={() => handleDelete(upload)}
                    >
                      {deletingIds.includes(upload.id) ? "Deleting…" : "Delete"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>

      {deleteError && (
        <p role="alert" className="text-sm text-danger">
          {deleteError}
        </p>
      )}
      {reindexError && (
        <p role="alert" className="text-sm text-danger">
          {reindexError}
        </p>
      )}

      {/* Document Preview Modal */}
      {preview && (
        <DocumentPreview
          documentId={preview.documentId}
          filename={preview.filename}
          fileType={preview.fileType}
          onClose={() => setPreview(null)}
        />
      )}

      {accessEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-auto p-6 shadow-xl">
            <div>
              <h2 className="font-display text-lg text-ink">Edit document access</h2>
              <p className="truncate text-xs text-slate">{accessEdit.filename}</p>
              <p className="mt-2 text-xs text-slate">
                Users must pass both department authorization and an allowed-role check.
              </p>
            </div>
            <form onSubmit={saveDocumentAccess} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                Department
                <select
                  value={accessDepartmentId}
                  onChange={(event) => {
                    const departmentId = event.target.value;
                    setAccessDepartmentId(departmentId);
                    const allowedRoleIds = new Set(
                      roles
                        .filter(
                          (role) =>
                            role.scope !== "department" ||
                            role.department_id === departmentId
                        )
                        .map((role) => role.id)
                    );
                    setAccessRoleIds((current) =>
                      [
                        ...new Set([
                          ...current.filter((id) => allowedRoleIds.has(id)),
                          ...roles
                            .filter((role) => role.is_owner)
                            .map((role) => role.id),
                        ]),
                      ]
                    );
                  }}
                  className="rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink"
                  required
                >
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
              </label>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-medium text-ink-soft">Allowed Roles</legend>
                {rolesLoading && <p className="text-xs text-slate">Loading roles…</p>}
                {rolesError && <p role="alert" className="text-xs text-danger">{rolesError}</p>}
                {rolesForAccessDepartment.map((role) => (
                  <label key={role.id} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={role.is_owner || accessRoleIds.includes(role.id)}
                      disabled={role.is_owner}
                      onChange={() =>
                        setAccessRoleIds((current) =>
                          current.includes(role.id)
                            ? current.filter((id) => id !== role.id)
                            : [...current, role.id]
                        )
                      }
                    />
                    {role.name}
                  </label>
                ))}
                {!rolesForAccessDepartment.length && !rolesLoading && !rolesError && (
                  <p className="text-xs text-slate">
                    No roles are available for this department.
                  </p>
                )}
              </fieldset>
              {accessError && <p role="alert" className="text-sm text-danger">{accessError}</p>}
              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={accessSaving}
                  onClick={() => setAccessEdit(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={accessSaving || rolesLoading || Boolean(rolesError) || !accessRoleIds.length}
                >
                  {accessSaving ? "Saving…" : "Save access"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

    </div>
  );
}
