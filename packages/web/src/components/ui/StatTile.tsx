import { Card, type CardTone } from "./Card";
import { Label } from "./Label";
import { cn } from "./cn";

export interface StatTileProps {
  value: number | string;
  label: string;
  tone?: CardTone;
  on?: "light" | "dark";
  className?: string;
}

/**
 * The stat trio on screen 8 and the 2x2 grid on screen 3: one big Anton number
 * over a tracked micro-label. Counts are always derived by the caller, never
 * hardcoded here.
 */
export function StatTile({
  value,
  label,
  tone = "yellow",
  on = "light",
  className,
}: StatTileProps) {
  const onDarkFill =
    tone === "ink" ||
    tone === "ink-deep" ||
    tone === "pink" ||
    tone === "orange";
  return (
    <Card
      tone={tone}
      on={on}
      lift="xs"
      border={4}
      radius={16}
      className={cn("flex flex-col gap-1 p-3.5", className)}
    >
      <span className="font-display text-30 leading-none tabular-nums">
        {value}
      </span>
      <Label size={9} className={onDarkFill ? "text-cream/80" : "text-rust"}>
        {label}
      </Label>
    </Card>
  );
}
