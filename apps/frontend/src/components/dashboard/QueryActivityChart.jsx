import { useEffect, useState } from "react";
import { getQueryAnalytics } from "../../lib/apiClient";
import Card from "../ui/Card";

function dayLabel(isoDate) {
    return new Date(isoDate + "T00:00:00Z").toLocaleDateString(undefined, {
        weekday: "short",
        timeZone: "UTC",
    });
}

export default function QueryActivityChart() {
    const [days, setDays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;
        getQueryAnalytics()
            .then((res) => {
                if (active) setDays(res.data ?? []);
            })
            .catch((err) => {
                if (active) setError(err.message);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const total = days.reduce((sum, d) => sum + d.count, 0);
    const max = Math.max(1, ...days.map((d) => d.count));

    return (
        <Card className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                    <h2 className="text-sm font-medium text-ink">Questions asked</h2>
                    <p className="text-xs text-slate">
                        Last 7 days (UTC), across your organization
                    </p>
                </div>
                {!loading && !error && (
                    <p className="text-xs text-slate">{total} total</p>
                )}
            </div>

            {loading ? (
                <p role="status" className="mt-4 text-sm text-slate">Loading activity...</p>
            ) : error ? (
                <p role="alert" className="mt-4 text-sm text-danger">
                    Failed to load activity: {error}
                </p>
            ) : total === 0 ? (
                <p className="mt-4 text-sm text-slate">No questions asked in the last 7 days.</p>
            ) : (
                <div
                    className="mt-4 flex h-40 items-end gap-2"
                    role="img"
                    aria-label={`Questions per day: ${days
                        .map((d) => `${dayLabel(d.date)} ${d.count}`)
                        .join(", ")}`}
                >
                    {days.map((d) => (
                        <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                            <span className="text-xs text-slate">{d.count}</span>
                            <div
                                className="w-full rounded-t bg-index"
                                style={{
                                    height: `${(d.count / max) * 100}%`,
                                    minHeight: d.count > 0 ? "4px" : "2px",
                                    opacity: d.count > 0 ? 1 : 0.25,
                                }}
                            />
                            <span className="text-xs text-slate-light">{dayLabel(d.date)}</span>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}