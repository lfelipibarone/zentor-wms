import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  expandRoleMatrixPermissions,
  Permission,
  resolveRolePermissions,
} from "@wms/shared";

describe("role permission matrix", () => {
  it("resolveRolePermissions uses matrix when present", () => {
    const perms = resolveRolePermissions("PICKER", [
      Permission.MOBILE_ACCESS,
      Permission.STOCK_VIEW,
    ]);
    assert.deepEqual(perms, [Permission.MOBILE_ACCESS, Permission.STOCK_VIEW]);
  });

  it("resolveRolePermissions falls back to defaults", () => {
    const perms = resolveRolePermissions("PICKER", null);
    assert.ok(perms.includes(Permission.MOBILE_ACCESS));
    assert.ok(!perms.includes(Permission.WEB_ACCESS));
  });

  it("ADMIN always gets full tenant permissions", () => {
    const perms = resolveRolePermissions("ADMIN", [Permission.MOBILE_ACCESS]);
    assert.ok(perms.includes(Permission.USERS_MANAGE));
    assert.ok(!perms.includes(Permission.TENANTS_MANAGE));
  });

  it("expandRoleMatrixPermissions adds derived keys", () => {
    const perms = expandRoleMatrixPermissions([
      Permission.WEB_ACCESS,
      Permission.REGISTERS_VIEW,
    ]);
    assert.ok(perms.includes(Permission.DASHBOARD_VIEW));
    assert.ok(perms.includes(Permission.PRODUCTS_MANAGE));
    assert.ok(perms.includes(Permission.NOTIFICATIONS_VIEW));
  });
});
