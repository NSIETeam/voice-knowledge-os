import { describe, expect, it } from "vitest";
import { workspaceNeedsBilling } from "./billing";
import type { CloudWorkspace } from "./cloud";

const workspace = (plan_status: CloudWorkspace["plan_status"]) =>
  ({ plan_status }) as CloudWorkspace;

describe("workspace billing gates", () => {
  it("never sends a non-billing self-hosted workspace to checkout", () => {
    expect(workspaceNeedsBilling(workspace("none"), false)).toBe(false);
    expect(workspaceNeedsBilling(workspace("canceled"), false)).toBe(false);
  });

  it("requires a live plan only when the server advertises billing", () => {
    expect(workspaceNeedsBilling(workspace("none"), true)).toBe(true);
    expect(workspaceNeedsBilling(workspace("trialing"), true)).toBe(false);
    expect(workspaceNeedsBilling(workspace("active"), true)).toBe(false);
  });
});
