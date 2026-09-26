import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";

export default function WorkspaceSettings() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Workspace settings</h1>
        <p className="text-sm text-slate">
          Admin-only. Configure workspace-level defaults.
        </p>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <Input id="ws-name" label="Workspace name" defaultValue="Acme Corp — IT" />
        <Input
          id="ws-domain"
          label="Allowed email domain"
          defaultValue="acmecorp.com"
        />
        <div className="flex items-center justify-between rounded-md border border-hairline px-3 py-2">
          <div>
            <p className="text-sm font-medium text-ink-soft">
              Require pre-approval for Intern uploads
            </p>
            <p className="text-xs text-slate">
              Documents uploaded by Interns are queued for Manager review.
            </p>
          </div>
          <input type="checkbox" defaultChecked className="h-4 w-4 accent-index" />
        </div>
        <Button className="self-start">Save changes</Button>
      </Card>
    </div>
  );
}
