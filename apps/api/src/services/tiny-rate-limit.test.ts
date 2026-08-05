import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TinyConnectionStatus } from "@prisma/client";
import {
  parseRateLimitResetMs,
  proactiveRateLimitDelayMs,
  formatRateLimitWaitMessage,
  readRateLimitUntilFromMetadata,
  isTinyConnectionUsableStatus,
  updateConnectionDocumentedLimit,
  getMinRequestIntervalMs,
} from "./tiny-rate-limit.js";

describe("tiny-rate-limit", () => {
  it("parseRateLimitResetMs usa segundos do header Olist", () => {
    const headers = new Headers({ "X-RateLimit-Reset": "5" });
    assert.equal(parseRateLimitResetMs(headers), 6_000);
  });

  it("parseRateLimitResetMs usa default quando header ausente", () => {
    assert.equal(parseRateLimitResetMs(new Headers()), 60_000);
  });

  it("proactiveRateLimitDelayMs aciona quando remaining baixo", () => {
    const headers = new Headers({
      "X-RateLimit-Remaining": "3",
      "X-RateLimit-Reset": "10",
    });
    assert.equal(proactiveRateLimitDelayMs(headers), 11_000);
  });

  it("readRateLimitUntilFromMetadata lê ISO", () => {
    const iso = "2030-01-01T00:00:00.000Z";
    const ms = readRateLimitUntilFromMetadata({ rateLimitUntil: iso });
    assert.equal(ms, Date.parse(iso));
  });

  it("formatRateLimitWaitMessage informa segundos", () => {
    const msg = formatRateLimitWaitMessage(Date.now() + 15_000);
    assert.match(msg, /aguarde ~1[0-9]s/);
  });

  it("getMinRequestIntervalMs respeita margem sobre o limite do plano", () => {
    updateConnectionDocumentedLimit("conn-test", new Headers({ "X-RateLimit-Limit": "30" }));
    assert.equal(getMinRequestIntervalMs("conn-test"), 2_300);
    assert.equal(getMinRequestIntervalMs("conn-unknown"), 575);
  });

  it("BLOCKED legado ainda é utilizável até reconciliar", () => {
    assert.equal(isTinyConnectionUsableStatus(TinyConnectionStatus.ERROR), false);
  });
});
