import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Needed even though `(member)/loading.tsx` exists: the nearest ancestor
 * boundary wins, and that would be the session screen's tap-target silhouette
 * one segment up — the wrong shape entirely for a list of log rows.
 */
export default function SessionLogsLoading() {
  return (
    <PageShell>
      <p role="status" className="sr-only">
        Loading your logs&hellip;
      </p>

      <Skeleton shape="bar" className="h-10 w-40" />

      <Card lift="sm" className="flex flex-col gap-3 px-4 py-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="flex items-center gap-3">
            <Skeleton shape="bar" className="h-3 w-14 shrink-0" />
            <Skeleton shape="bar" className="h-4 flex-1" />
            <Skeleton shape="bar" className="h-6 w-16 shrink-0 rounded-99" />
          </span>
        ))}
      </Card>
    </PageShell>
  );
}
