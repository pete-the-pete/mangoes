import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      {/* No redirect props on purpose. These come from
          NEXT_PUBLIC_CLERK_SIGN_IN_URL and
          NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL, set in Vercel across
          all three environments — so `vercel env pull` writes them into
          packages/web/.env.local instead of wiping them, which is what made
          props the right call before. Props take precedence over the env vars,
          so setting both would give the same value two sources of truth. */}
      <SignIn />
    </div>
  );
}
