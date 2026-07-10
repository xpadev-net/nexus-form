import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requestLogger } from "../request-logging";

describe("requestLogger", () => {
  it("sanitizes request-start and response-completion targets", async () => {
    const logs: string[] = [];
    const app = new Hono();
    app.use(
      "*",
      requestLogger((message) => logs.push(message)),
    );
    app.get("/api/forms/:formId/shared/:token", (c) => c.text("ok"));

    const response = await app.request(
      "/api/forms/form-123/shared/shared-link-secret?state=state-secret",
    );

    expect(response.status).toBe(200);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toBe("<-- GET /api/forms/form-123/shared/[REDACTED]");
    expect(logs[1]).toMatch(
      /^--> GET \/api\/forms\/form-123\/shared\/\[REDACTED\] 200 \d+(ms|s)$/,
    );
    expect(logs.join("\n")).not.toContain("shared-link-secret");
    expect(logs.join("\n")).not.toContain("state-secret");
  });

  it("keeps completion logging after an error is converted to a response", async () => {
    const logs: string[] = [];
    const app = new Hono();
    app.use(
      "*",
      requestLogger((message) => logs.push(message)),
    );
    app.get("/api/auth/callback/:provider", () => {
      throw new Error("route failed");
    });
    app.onError((_error, c) => c.text("failed", 500));

    const response = await app.request(
      "/api/auth/callback/discord?code=code-secret&state=state-secret",
    );

    expect(response.status).toBe(500);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toBe("<-- GET /api/auth/callback/discord");
    expect(logs[1]).toMatch(
      /^--> GET \/api\/auth\/callback\/discord 500 \d+(ms|s)$/,
    );
    expect(logs.join("\n")).not.toContain("code-secret");
    expect(logs.join("\n")).not.toContain("state-secret");
  });

  it("logs completion before propagating an unhandled downstream error", async () => {
    const logs: string[] = [];
    const app = new Hono();
    app.use(
      "*",
      requestLogger((message) => logs.push(message)),
    );
    app.get("/api/forms/:formId", () => {
      throw new Error("route failed");
    });
    app.onError(() => {
      throw new Error("error handler failed");
    });

    await expect(app.request("/api/forms/form-123")).rejects.toThrow(
      "error handler failed",
    );

    expect(logs).toHaveLength(2);
    expect(logs[0]).toBe("<-- GET /api/forms/form-123");
    expect(logs[1]).toMatch(/^--> GET \/api\/forms\/form-123 200 \d+(ms|s)$/);
  });
});
