import { currentUser } from "@clerk/nextjs/server";
import { PageShell } from "@/components/ui/PageShell";
import { Label } from "@/components/ui/Label";
import { AccountNameForm } from "./AccountNameForm";

// Names live in Clerk, so this reads straight from `currentUser()` rather than
// through adminUsers/cycleParticipants — those exist to join Clerk names onto
// this app's rows, and there is no row to join here.
export default async function AccountPage() {
  const user = await currentUser();
  if (!user) {
    // (member)/layout.tsx already redirects signed-out visitors before this
    // renders; this is defense in depth, matching the other member pages.
    return null;
  }

  return (
    <PageShell>
      <header className="flex flex-col gap-2">
        <Label size={10} className="text-rust">
          🥭 Your account
        </Label>
        <h1 className="font-display text-42">Your name</h1>
        <Label size={11} as="p" className="text-rust">
          This is what everyone in your groups sees next to your taps. Leave it
          blank and you show up as an unnamed member.
        </Label>
      </header>

      <AccountNameForm
        initialFirstName={user.firstName ?? ""}
        initialLastName={user.lastName ?? ""}
      />
    </PageShell>
  );
}
