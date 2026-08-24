import { SignUp } from "@clerk/nextjs";

// Invite acceptance lands here. POST /admin/api/users/invite sets the
// invitation's redirectUrl to this route, so Clerk sends the invitee back into
// the app with `__clerk_ticket` in the query string rather than finishing the
// flow on its own Account Portal.
//
// Catch-all, like /sign-in: Clerk routes to sub-paths such as
// /sign-up/continue partway through the flow.
export default function SignUpPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      {/* Redirects come from the NEXT_PUBLIC_CLERK_SIGN_UP_* env vars — see the
          note in the sign-in page for why they aren't props. Sign-ups are
          invitation-only at the instance level, so this page is only ever
          reachable with a valid ticket. */}
      <SignUp />
    </div>
  );
}
