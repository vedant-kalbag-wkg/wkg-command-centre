import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppNavbar } from "@/components/layout/app-navbar";

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
    <div className="flex min-h-dvh flex-col">
      <AppNavbar
        user={{
          name: session.user.name,
          email: session.user.email,
          role: (session.user.role as string) || "member",
        }}
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
