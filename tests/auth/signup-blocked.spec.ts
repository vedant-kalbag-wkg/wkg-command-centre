import { test, expect } from "@playwright/test";

test.describe("Signup blocked", () => {
  test("POST /api/auth/sign-up returns error (signup disabled)", async ({
    page,
  }) => {
    const response = await page.request.post("/api/auth/sign-up/email", {
      data: {
        email: "newuser@example.com",
        password: "Test1234!",
        name: "New User",
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Better Auth should reject signup since disableSignUp is true
    // It may return 403, 400, or 200 with an error body depending on version
    const body = await response.json();

    // Check that either status is error or the response indicates failure
    const signupRejected =
      response.status() !== 200 ||
      body?.error !== undefined ||
      body?.code === "SIGNUP_DISABLED";

    expect(signupRejected).toBe(true);
  });
});
