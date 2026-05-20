import { describe, expect, it } from "vitest";
import { createCsrfOriginGuard } from "../csrf-origin-guard";
import { createHonoApp } from "../hono";

function createTestApp() {
  return createHonoApp()
    .use("/api/*", createCsrfOriginGuard(["https://app.example.com"]))
    .get("/api/forms", (c) => c.json({ ok: true }))
    .post("/api/forms", (c) => c.json({ ok: true }))
    .post("/api/auth/sign-out", (c) => c.json({ ok: true }));
}

describe("createCsrfOriginGuard", () => {
  it("allows state-changing requests without cookies", async () => {
    const res = await createTestApp().request("/api/forms", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        origin: "https://evil.example.com",
      },
    });

    expect(res.status).toBe(200);
  });

  it("allows state-changing cookie requests from trusted origins", async () => {
    const res = await createTestApp().request("/api/forms", {
      method: "POST",
      headers: {
        cookie: "nexus-form.session_token=value",
        origin: "https://app.example.com",
      },
    });

    expect(res.status).toBe(200);
  });

  it("allows state-changing cookie requests with a trusted referer", async () => {
    const res = await createTestApp().request("/api/forms", {
      method: "POST",
      headers: {
        cookie: "nexus-form.session_token=value",
        referer: "https://app.example.com/forms/123",
      },
    });

    expect(res.status).toBe(200);
  });

  it("rejects state-changing cookie requests from untrusted origins", async () => {
    const res = await createTestApp().request("/api/forms", {
      method: "POST",
      headers: {
        cookie: "nexus-form.session_token=value",
        origin: "https://evil.example.com",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects untrusted origins even when referer is trusted", async () => {
    const res = await createTestApp().request("/api/forms", {
      method: "POST",
      headers: {
        cookie: "nexus-form.session_token=value",
        origin: "https://evil.example.com",
        referer: "https://app.example.com/forms/123",
      },
    });

    expect(res.status).toBe(403);
  });

  it("rejects state-changing cookie requests without origin or referer", async () => {
    const res = await createTestApp().request("/api/forms", {
      method: "POST",
      headers: {
        cookie: "nexus-form.session_token=value",
      },
    });

    expect(res.status).toBe(403);
  });

  it("allows non-state-changing cookie requests without origin or referer", async () => {
    const res = await createTestApp().request("/api/forms", {
      headers: {
        cookie: "nexus-form.session_token=value",
      },
    });

    expect(res.status).toBe(200);
  });

  it("leaves Better Auth routes to Better Auth", async () => {
    const res = await createTestApp().request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        cookie: "nexus-form.session_token=value",
      },
    });

    expect(res.status).toBe(200);
  });
});
