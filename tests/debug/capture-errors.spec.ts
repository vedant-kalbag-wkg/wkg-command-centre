import { test } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("verify React state update error is gone after fix", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__stateUpdateErrors = [];
    const origError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      const msg = String(args[0] ?? '');
      if (msg.includes("state update") || msg.includes("hasn't mounted")) {
        (window as any).__stateUpdateErrors.push({
          message: msg,
          jsStack: new Error().stack,
        });
      }
      origError(...args);
    };
  });

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
      console.log("CONSOLE ERROR:", msg.text().substring(0, 150));
    }
  });

  await signInAsAdmin(page);
  console.log("Signed in, waiting for render...");
  await page.waitForTimeout(3000);

  const stateErrors = await page.evaluate(() => (window as any).__stateUpdateErrors);
  
  console.log("\n=== RESULTS ===");
  console.log("State update errors:", stateErrors.length);
  console.log("Total console errors:", consoleErrors.length);
  
  if (stateErrors.length > 0) {
    console.log("STATE UPDATE ERROR DETAILS:", JSON.stringify(stateErrors[0], null, 2));
  }

  if (stateErrors.length === 0 && !consoleErrors.some(e => e.includes("state update"))) {
    console.log("SUCCESS: Error is gone!");
  } else {
    console.log("STILL FAILING: Error persists");
  }
});
