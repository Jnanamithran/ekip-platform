import Card from "../components/ui/Card";
import QueryActivityChart from "../components/dashboard/QueryActivityChart";

export default function Analytics() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="font-display text-xl text-ink">Analytics</h1>
        <p className="text-sm text-slate">Organization search activity over the last seven days.</p>
      </div>
      <Card className="p-5">
        <QueryActivityChart />
      </Card>
    </div>
  );
}
