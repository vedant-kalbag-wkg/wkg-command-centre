import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { sendPasswordResetEmail, sendInviteEmail, sendExternalInviteEmail } from "@/lib/email";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // LOCKED DECISION: invite-only, no public registration
    sendResetPassword: async ({ user, url }) => {
      const isInvite = url.includes("invite=1");
      const userType = (user as Record<string, unknown>).userType as string | undefined;

      if (isInvite && userType === "external") {
        await sendExternalInviteEmail({ to: user.email, setPasswordUrl: url });
      } else if (isInvite) {
        await sendInviteEmail({ to: user.email, resetUrl: url });
      } else {
        await sendPasswordResetEmail({ to: user.email, resetUrl: url });
      }
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days — LOCKED DECISION
    updateAge: 60 * 60 * 24, // Refresh daily (sliding window)
  },
  user: {
    additionalFields: {
      // Surface the userType column on session.user so the proxy can gate
      // external users out of internal routes. `input: false` keeps it out
      // of any signup payload — userType is set at invite time, not by users.
      userType: {
        type: "string",
        input: false,
        required: false,
      },
    },
  },
  plugins: [
    admin({
      defaultRole: "member",
      adminRoles: ["admin"],
    }),
    nextCookies(), // MUST be last — handles Set-Cookie in Server Actions
  ],
});
