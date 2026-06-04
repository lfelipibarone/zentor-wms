import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSeedDemoTenantSlug } from "./demo-tenant-cleanup.js";

describe("demo-tenant-cleanup", () => {
  it("identifica tenants de demo", () => {
    assert.equal(isSeedDemoTenantSlug("default"), true);
    assert.equal(isSeedDemoTenantSlug("demo-loja-a"), true);
    assert.equal(isSeedDemoTenantSlug("demo-loja-b"), true);
    assert.equal(isSeedDemoTenantSlug("empresa-real"), false);
    assert.equal(isSeedDemoTenantSlug("tenant-producao"), false);
  });
});
