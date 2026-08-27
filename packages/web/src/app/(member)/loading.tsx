import { PageShell } from "@/components/ui/PageShell";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The member route group's instant loading state.
 *
 * Sits inside `(member)/layout.tsx`, so `MemberNav` stays rendered and
 * interactive while this shows — the nav is not part of the fallback.
 *
 * Before this file existed there was no Suspense boundary anywhere in the app,
 * which meant tapping a link left the previous page fully rendered until the
 * server finished. That is the whole "nothing happens when I click" complaint.
 */
export default function MemberLoading() {
  return (
    <PageShell>
      {/* One announcement for the whole fallback. The placeholders themselves
          are aria-hidden, or a screen reader reads out a dozen empty nodes. */}
      <p role="status" className="sr-only">
        Loading&hellip;
      </p>

      <Skeleton shape="bar" className="h-10 w-48" />

      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} lift="sm" className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton shape="circle" className="w-11 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton shape="bar" className="h-4 w-2/5" />
              <Skeleton shape="bar" className="h-3 w-3/5" />
            </span>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
