"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export default function ComingSoonPage() {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold">
          External portal coming soon
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          The WeKnow analytics portal for partners and venues is in Phase 2.
          Your account is provisioned — you will be notified when the portal is
          live.
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex h-9 items-center justify-center rounded-md bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
