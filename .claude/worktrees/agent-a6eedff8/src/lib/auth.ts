import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { sendPasswordResetEmail } from "@/lib/email";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // LOCKED DECISION: invite-only, no public registration
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ to: user.email, resetUrl: url });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days — LOCKED DECISION
    updateAge: 60 * 60 * 24, // Refresh daily (sliding window)
  },
  plugins: [
    admin({
      defaultRole: "member",
      adminRoles: ["admin"],
    }),
    nextCookies(), // MUST be last — handles Set-Cookie in Server Actions
  ],
});
