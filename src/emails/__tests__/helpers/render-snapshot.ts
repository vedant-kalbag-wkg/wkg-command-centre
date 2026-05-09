import { render } from "@react-email/render";
import type { ReactElement } from "react";

// Phase 8 Plan 08-01 — Helper for future template snapshot tests
// (Phase 9 may extend). Wraps @react-email/render with the same
// Promise<string> return shape regardless of SDK version.
export async function renderEmail(component: ReactElement): Promise<string> {
  return await render(component);
}
