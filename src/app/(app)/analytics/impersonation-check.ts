"use server";

import { cookies } from "next/headers";

export async function getImpersonationStatus(): Promise<{
  active: boolean;
  userName: string | null;
}> {
  const cookieStore = await cookies();
  const userId = cookieStore.get("impersonating_user_id")?.value;
  const userName = cookieStore.get("impersonating_user_name")?.value ?? null;

  return {
    active: !!userId,
    userName,
  };
}
