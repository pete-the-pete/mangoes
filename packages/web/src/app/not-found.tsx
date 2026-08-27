import { PageShell } from "@/components/ui/PageShell";
import { ButtonLink } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";

/** Replaces Next's bare default 404 with the app's own sticker styling. */
export default function NotFound() {
  return (
    <PageShell className="items-center justify-center text-center">
      <span aria-hidden="true" className="text-[4.5rem] leading-none">
        🥭
      </span>
      <h1 className="font-display text-42">Nothing here</h1>
      <Label size={11} as="p" className="text-ink/70">
        This page doesn&rsquo;t exist, or you don&rsquo;t have access to it.
      </Label>
      <ButtonLink href="/">Back to the app</ButtonLink>
    </PageShell>
  );
}
