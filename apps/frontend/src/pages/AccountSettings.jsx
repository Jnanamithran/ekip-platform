import { useAuth } from "../lib/AuthContext";
import { useState } from "react";
import { changePassword } from "../lib/apiClient";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";

export default function AccountSettings() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Account</h1>
        <p className="text-sm text-slate">
          Your account details and password settings.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-ink">Account details</h2>
        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <dt className="text-ink-soft">Email</dt>
          <dd className="text-ink">{user?.email ?? "—"}</dd>
          <dt className="text-ink-soft">Role</dt>
          <dd className="text-ink">
            {user?.is_owner ? "Owner (protected)" : user?.role ?? "—"}
          </dd>
          <dt className="text-ink-soft">Department</dt>
          <dd className="text-ink">{user?.department ?? "—"}</dd>
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-medium text-ink">Change password</h2>
        <p className="text-sm text-slate mb-4">
          Update your EKIP account password.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-ink-soft">
            Current password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="rounded-md border border-hairline bg-white px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-soft">
            New password
            <input
              required
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="rounded-md border border-hairline bg-white px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-soft">
            Confirm new password
            <input
              required
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="rounded-md border border-hairline bg-white px-3 py-2"
            />
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {notice && <p role="status" className="text-sm text-success">{notice}</p>}
          <Button type="submit" disabled={saving}>
            {saving ? "Updating…" : "Change password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
