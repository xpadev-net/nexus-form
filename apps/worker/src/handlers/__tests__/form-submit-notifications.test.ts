import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureError: vi.fn(),
  dbSelect: vi.fn(),
  snapshotRows: [] as Array<{ structureJson: string }>,
}));

vi.mock("@nexus-form/database/schema", () => ({
  formSnapshot: {
    formId: "formSnapshot.formId",
    structureJson: "formSnapshot.structureJson",
    version: "formSnapshot.version",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
}));

vi.mock("../../lib/db", () => ({
  db: {
    select: mocks.dbSelect,
  },
}));

vi.mock("../../lib/sentry", () => ({
  captureError: mocks.captureError,
}));

import { handleFormSubmitNotifications } from "../form-submit-notifications";

const DISCORD_URL = "https://discord.com/api/webhooks/123/discord-token";
const WEBHOOK_URL = "https://zapier.com/hooks/catch/current";
const WEBHOOK_SECRET = "current-secret-current-secret-123456";

function makeJob(data: unknown): Job<unknown> {
  return {
    id: "job-1",
    data,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<unknown>;
}

function baseJobData() {
  return {
    formId: "form-1",
    responseId: "response-1",
    snapshotVersion: 7,
    submittedAt: "2026-06-03T00:00:00.000Z",
  };
}

function setupSnapshotNotifications(notifications: Record<string, unknown>) {
  mocks.snapshotRows = [
    {
      structureJson: JSON.stringify({
        version: 1,
        settings: { allow_edit_responses: false },
        notifications,
      }),
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshotRows = [];
  mocks.dbSelect.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mocks.snapshotRows),
      })),
    })),
  }));
  vi.stubEnv("NODE_ENV", "test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});

describe("handleFormSubmitNotifications", () => {
  it("rejects invalid job data before any delivery attempt", async () => {
    await expect(
      handleFormSubmitNotifications(makeJob({ formId: "form-1" })),
    ).rejects.toThrow();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only enabled Discord and webhook channels", async () => {
    setupSnapshotNotifications({
      on_submit: {
        email: {
          enabled: false,
          recipients: ["owner@example.com"],
        },
        discord: {
          enabled: true,
          webhook_url: DISCORD_URL,
          message_template: "response {{response_id}}",
        },
        webhook: {
          enabled: true,
          url: WEBHOOK_URL,
          secret: WEBHOOK_SECRET,
          timeout_seconds: 30,
          retry_attempts: 0,
        },
      },
    });
    const job = makeJob(baseJobData());

    const result = await handleFormSubmitNotifications(job);

    expect(result).toEqual({
      delivered: ["discord", "webhook"],
      skipped: [],
      failed: [],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledWith(
      DISCORD_URL,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "response response-1" }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      WEBHOOK_URL,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          event: "form.response_submitted",
          form_id: "form-1",
          response_id: "response-1",
          snapshot_version: 7,
          submitted_at: "2026-06-03T00:00:00.000Z",
        }),
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-nexus-form-delivery-id": "form-1:response-1:webhook",
          "x-nexus-form-event": "form.response_submitted",
          "x-nexus-form-signature": expect.stringMatching(/^sha256=[a-f0-9]+$/),
        }),
      }),
    );
    expect(job.updateProgress).toHaveBeenCalledWith(result);
  });

  it("records channel failure without throwing or logging raw secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    setupSnapshotNotifications({
      on_submit: {
        webhook: {
          enabled: true,
          url: WEBHOOK_URL,
          secret: WEBHOOK_SECRET,
          timeout_seconds: 30,
          retry_attempts: 1,
        },
      },
    });
    const job = makeJob(baseJobData());

    const result = await handleFormSubmitNotifications(job);

    expect(result).toEqual({
      delivered: [],
      skipped: [],
      failed: ["webhook"],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.captureError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(WEBHOOK_URL);
    expect(logged).not.toContain(WEBHOOK_SECRET);
    expect(job.updateProgress).toHaveBeenCalledWith(result);
  });

  it("records production email provider gaps without sending Sentry events", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setupSnapshotNotifications({
      on_submit: {
        email: {
          enabled: true,
          recipients: ["owner@example.com"],
        },
      },
    });
    const job = makeJob(baseJobData());

    const result = await handleFormSubmitNotifications(job);

    expect(result).toEqual({
      delivered: [],
      skipped: [],
      failed: ["email"],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      "[notification] channel delivery skipped",
      expect.objectContaining({
        channel: "email",
        formId: "form-1",
        responseId: "response-1",
        errorMessage: "Email notification provider is not configured",
      }),
    );
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it("marks dev email notifications as skipped instead of delivered", async () => {
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    setupSnapshotNotifications({
      on_submit: {
        email: {
          enabled: true,
          recipients: ["owner@example.com"],
        },
      },
    });
    const job = makeJob(baseJobData());

    const result = await handleFormSubmitNotifications(job);

    expect(result).toEqual({
      delivered: [],
      skipped: ["email"],
      failed: [],
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(consoleInfo).toHaveBeenCalledWith(
      "[notification:email] dev notification generated",
      expect.objectContaining({
        formId: "form-1",
        responseId: "response-1",
        recipientCount: 1,
      }),
    );
    expect(job.updateProgress).toHaveBeenCalledWith(result);
  });
});
