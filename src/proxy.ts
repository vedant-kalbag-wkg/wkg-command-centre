import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { shouldGateExternalUser } from "@/lib/auth/gating";

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/reset-password") ||
    request.nextUrl.pathname.startsWith("/set-password");

  if (!session && !isAuthRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (session && isAuthRoute) {
    const userType = (session.user as { userType?: string }).userType;
    const target = userType === "external" ? "/portal/analytics/portfolio" : "/kiosks";
    return NextResponse.redirect(new URL(target, request.url));
  }

  // External-user gating: external users may only access /portal/**, auth
  // routes, and root. Everything else redirects to the portal stub.
  if (session && (session.user as { userType?: "internal" | "external" }).userType === "external") {
    const p = request.nextUrl.pathname;
    if (shouldGateExternalUser("external", p)) {
      return NextResponse.redirect(new URL("/portal/analytics/portfolio", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
