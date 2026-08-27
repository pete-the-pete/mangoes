import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The core loop screen's own fallback, shaped rather than generic — this is the
 * screen members open most, and it is worth showing them the tap target's
 * silhouette in the right place instead of a stack of bars.
 *
 * Mirrors SessionScreen's outer div rather than using PageShell, because that
 * screen doesn't use PageShell either (it needs the full-bleed sunburst layer).
 * The hero circle's `size-[min(68vw,268px)]` is TapTarget's `large` size — keep
 * them in step or the fallback visibly jumps when the real screen swaps in.
 */
export default function SessionLoading() {
  return (
    <div className="bg-cream relative flex flex-1 flex-col gap-4 overflow-hidden px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <p role="status" className="sr-only">
        Loading session&hellip;
      </p>

      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <Skeleton shape="bar" className="h-8 w-44 rounded-99" />
          <Skeleton shape="bar" className="h-8 w-24 rounded-99" />
        </div>
        {/* The real tab bar is a bordered pill, so the fallback keeps the border
            and fakes only the three labels inside it. */}
        <div className="border-ink bg-cream rounded-99 flex items-stretch gap-2 overflow-hidden border-4 border-solid p-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} shape="bar" className="h-5 flex-1" />
          ))}
        </div>
      </header>

      <div className="flex justify-center py-6">
        <Skeleton shape="circle" className="w-[min(68vw,268px)]" />
      </div>

      <Card lift="sm" className="flex flex-col gap-3 px-4 py-4">
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex items-center gap-3">
            <Skeleton shape="circle" className="w-9 shrink-0" />
            <Skeleton shape="bar" className="h-4 flex-1" />
            <Skeleton shape="bar" className="h-4 w-10 shrink-0" />
          </span>
        ))}
      </Card>
    </div>
  );
}
