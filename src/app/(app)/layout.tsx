import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellV2 } from "@/components/layout/app-shell-v2";
import { AbilityProvider } from "@/lib/casl/ability-context";
import { getUserCtx } from "@/lib/auth/get-user-ctx";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/login");

  const ctx = await getUserCtx();

  return (
    <AbilityProvider rules={ctx.ability.rules}>
      <AppShellV2
        user={{
          name: session.user.name,
          email: session.user.email,
          role: (session.user.role as string) || "member",
        }}
      >
        {children}
      </AppShellV2>
    </AbilityProvider>
  );
}
