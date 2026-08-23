import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      {/* Without an explicit fallback Clerk lands on `/` after sign-in. Set here
          rather than via NEXT_PUBLIC_CLERK_SIGN_IN_URL: packages/web/.env.local is
          `vercel env pull` output, so a hand-added key is wiped on the next pull. */}
      <SignIn fallbackRedirectUrl="/admin" />
    </div>
  );
}
