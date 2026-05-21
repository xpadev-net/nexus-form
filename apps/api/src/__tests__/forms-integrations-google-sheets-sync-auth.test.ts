import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  getFormIntegration: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", {
        auth_type: "session",
        user_id: "owner-user-id",
      });
      await next();
    };
  },
}));

vi.mock("../lib/forms/form-integration-service", async () => {
  const { z } = await import("zod");

  return {
    GoogleSheetsIntegrationSettingSchema: z.object({
      spreadsheetId: z.string(),
      sheetName: z.string(),
    }),
    getFormIntegration: mocks.getFormIntegration,
    upsertFormIntegration: vi.fn(),
  };
});

vi.mock("../lib/queues", () => ({
  getSheetsSyncQueue: () => ({
    getJob: mocks.getJob,
  }),
}));

function configuredIntegration(formId: string) {
  return {
    id: "integration-1",
    formId,
    ownerUserId: "owner-user-id",
    userId: "owner-user-id",
    config: {
      spreadsheetId: "spreadsheet-1",
      sheetName: "Sheet1",
    },
    createdAt: new Date("2026-05-21T00:00:00.000Z"),
    updatedAt: new Date("2026-05-21T00:00:00.000Z"),
  };
}

function sheetsJob(data: unknown, id = "sheets:integration-1:response-1") {
  return {
    attemptsMade: 1,
    data,
    failedReason: "sensitive google api error",
    getState: vi.fn(async () => "failed"),
    id,
    name: "auto-sync",
    progress: {
      spreadsheetId: "other-spreadsheet",
    },
    returnvalue: {
      sheetName: "OtherTenantSheet",
    },
  };
}

describe("Google Sheets sync job status authorization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getFormIntegration.mockResolvedValue(configuredIntegration("form-1"));
  });

  it("returns 404 without leaking job details when the job belongs to another form", async () => {
    const foreignJob = sheetsJob(
      {
        formId: "other-form",
        integrationId: "other-integration",
        responseId: "response-1",
      },
      "sheets:other-integration:response-1",
    );
    mocks.getJob.mockResolvedValueOnce(foreignJob);

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync/sheets:other-integration:response-1",
    );
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(JSON.parse(body)).toEqual({ error: "Job not found" });
    expect(body).not.toContain("other-spreadsheet");
    expect(body).not.toContain("OtherTenantSheet");
    expect(body).not.toContain("sensitive google api error");
    expect(foreignJob.getState).not.toHaveBeenCalled();
  });

  it("returns same-form sync job status", async () => {
    const job = sheetsJob({
      formId: "form-1",
      integrationId: "integration-1",
      responseId: "response-1",
    });
    mocks.getJob.mockResolvedValueOnce(job);

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync/sheets:integration-1:response-1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      job: {
        attemptsMade: 1,
        id: "sheets:integration-1:response-1",
        name: "auto-sync",
        state: "failed",
      },
    });
    expect(job.getState).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for malformed sync job data", async () => {
    const malformedJob = sheetsJob({
      integrationId: "integration-1",
      responseId: "response-1",
    });
    mocks.getJob.mockResolvedValueOnce(malformedJob);

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync/sheets:integration-1:response-1",
    );

    expect(response.status).toBe(404);
    expect(malformedJob.getState).not.toHaveBeenCalled();
  });

  it("returns 404 when the job belongs to a stale integration for the same form", async () => {
    const staleIntegrationJob = sheetsJob(
      {
        formId: "form-1",
        integrationId: "stale-integration",
        responseId: "response-1",
      },
      "sheets:stale-integration:response-1",
    );
    mocks.getJob.mockResolvedValueOnce(staleIntegrationJob);

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync/sheets:stale-integration:response-1",
    );

    expect(response.status).toBe(404);
    expect(staleIntegrationJob.getState).not.toHaveBeenCalled();
  });
});
