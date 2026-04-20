import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShellV2 } from "@/components/layout/app-shell-v2";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/login");

  return (
    <AppShellV2
      user={{
        name: session.user.name,
        email: session.user.email,
        role: (session.user.role as string) || "member",
      }}
    >
      {children}
    </AppShellV2>
  );
}
