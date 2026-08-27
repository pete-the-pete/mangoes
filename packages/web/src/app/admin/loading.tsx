import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The admin route group's instant loading state. `width="wide"` to match the
 * admin column, and `on="dark"` skeletons because these screens sit on the dark
 * surface where an ink stripe is invisible.
 *
 * Admin pages are the slowest in the app — several run five sequential awaits,
 * two of them Clerk round trips — so this is the fallback that shows longest.
 */
export default function AdminLoading() {
  return (
    <PageShell width="wide">
      <p role="status" className="sr-only">
        Loading&hellip;
      </p>

      <Skeleton shape="bar" on="dark" className="h-10 w-56" />

      <div className="flex flex-wrap gap-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} tone="ink" on="dark" lift="sm" className="flex-1 basis-40 px-4 py-3.5">
            <Skeleton shape="bar" on="dark" className="h-8 w-20" />
            <Skeleton shape="bar" on="dark" className="mt-2 h-3 w-24" />
          </Card>
        ))}
      </div>

      <Card tone="ink" on="dark" lift="sm" className="flex flex-col gap-3 px-4 py-4">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="flex items-center gap-3">
            <Skeleton shape="circle" on="dark" className="w-9 shrink-0" />
            <Skeleton shape="bar" on="dark" className="h-4 flex-1" />
            <Skeleton shape="bar" on="dark" className="h-6 w-16 shrink-0" />
          </span>
        ))}
      </Card>
    </PageShell>
  );
}
