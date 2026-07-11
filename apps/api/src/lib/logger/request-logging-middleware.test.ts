import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  getRequestErrorTarget,
  INVALID_REQUEST_TARGET,
  requestLogger,
} from "../request-logging";

describe("requestLogger", () => {
  it("fails closed when malformed targets have only a generic route path", () => {
    const malformedTarget = "/api/forms/form-123\u0000secret";

    expect(getRequestErrorTarget(malformedTarget, "*")).toBe(
      INVALID_REQUEST_TARGET,
    );
    expect(getRequestErrorTarget(malformedTarget, "/api/forms/:formId")).toBe(
      "/api/forms/:formId",
    );
  });

  it("redacts password reset tokens in request-start and completion logs", async () => {
    const logs: string[] = [];
    const app = new Hono();
    app.use(
      "*",
      requestLogger((message) => logs.push(message)),
    );
    app.get("/api/auth/reset-password/:token", (c) => c.text("ok"));

    const response = await app.request(
      "/api/auth/reset-password/reset-token-secret?redirect=secret",
    );

    expect(response.status).toBe(200);
    expect(logs[0]).toBe("<-- GET /api/auth/reset-password/[REDACTED]");
    expect(logs[1]).toMatch(
      /^--> GET \/api\/auth\/reset-password\/\[REDACTED\] 200 \d+(ms|s)$/,
    );
    expect(logs.join("\n")).not.toContain("reset-token-secret");
    expect(logs.join("\n")).not.toContain("redirect=secret");
  });

  it("redacts password reset tokens in error-log targets", () => {
    const errorTarget = getRequestErrorTarget(
      "/api/auth/reset-password/reset-token-secret?redirect=secret",
      "/api/auth/reset-password/:token",
    );

    expect(errorTarget).toBe("/api/auth/reset-password/[REDACTED]");
    expect(errorTarget).not.toContain("reset-token-secret");
  });

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
    expect(logs[1]).toMatch(/^--> GET \/api\/forms\/form-123 500 \d+(ms|s)$/);
  });

  it("preserves an HTTPException status when the error becomes a response", async () => {
    const logs: string[] = [];
    const app = new Hono();
    app.use(
      "*",
      requestLogger((message) => logs.push(message)),
    );
    app.get("/api/forms/:formId", () => {
      throw new HTTPException(400, { message: "bad request" });
    });
    app.onError((error) => {
      if (error instanceof HTTPException) {
        return error.getResponse();
      }
      return new Response("failed", { status: 500 });
    });

    const response = await app.request("/api/forms/form-123");

    expect(response.status).toBe(400);
    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatch(/^--> GET \/api\/forms\/form-123 400 \d+(ms|s)$/);
  });
});
