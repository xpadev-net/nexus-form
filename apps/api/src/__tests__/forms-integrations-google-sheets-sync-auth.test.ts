import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  addBulk: vi.fn(),
  db: {
    select: vi.fn(),
  },
  getFormIntegration: vi.fn(),
  getJob: vi.fn(),
  responseRows: [] as Array<{ responseId: string }>,
  upsertFormIntegrationForCurrentOwner: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
  formResponse: {
    formId: "formResponse.formId",
    id: "formResponse.id",
    submittedAt: "formResponse.submittedAt",
  },
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
      headerPolicy: z.literal("extend"),
    }),
    getFormIntegration: mocks.getFormIntegration,
    upsertFormIntegrationForCurrentOwner:
      mocks.upsertFormIntegrationForCurrentOwner,
  };
});

vi.mock("../lib/queues", () => ({
  SHEETS_SYNC_MANUAL_RETRY_JOB_OPTIONS: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 30_000,
    },
  },
  getSheetsSyncQueue: () => ({
    addBulk: mocks.addBulk,
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
      headerPolicy: "extend",
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
    mocks.responseRows = [];
    mocks.getFormIntegration.mockResolvedValue(configuredIntegration("form-1"));
    mocks.db.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async (limit: number) =>
              mocks.responseRows.slice(0, limit),
            ),
          })),
        })),
      })),
    }));
    mocks.addBulk.mockImplementation(
      async (
        jobs: Array<{
          data: { responseId: string };
          opts?: { jobId?: string };
        }>,
      ) =>
        jobs.map((job) => ({
          id: job.opts?.jobId ?? `job-${job.data.responseId}`,
        })),
    );
  });

  it("saves a Google Sheets integration through the current-owner service path", async () => {
    mocks.upsertFormIntegrationForCurrentOwner.mockResolvedValueOnce({
      ...configuredIntegration("form-1"),
      ownerUserId: "new-owner-user-id",
      userId: "new-owner-user-id",
    });

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          spreadsheetId: "spreadsheet-1",
          sheetName: "Sheet1",
          headerPolicy: "extend",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.upsertFormIntegrationForCurrentOwner).toHaveBeenCalledWith({
      formId: "form-1",
      config: {
        spreadsheetId: "spreadsheet-1",
        sheetName: "Sheet1",
        headerPolicy: "extend",
      },
    });
  });

  it("queues bounded manual sync jobs with deterministic ids and retry settings", async () => {
    mocks.responseRows = [
      { responseId: "response-1" },
      { responseId: "response-2" },
    ];

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ force: true }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "queued",
    });
    expect(mocks.addBulk).toHaveBeenCalledTimes(1);
    const queuedJobs = mocks.addBulk.mock.calls[0]?.[0];
    expect(queuedJobs).toHaveLength(2);
    expect(queuedJobs?.[0]).toMatchObject({
      name: "manual-sync",
      data: {
        formId: "form-1",
        integrationId: "integration-1",
        responseId: "response-1",
      },
    });
    expect(queuedJobs?.[0]?.opts).toMatchObject({
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30_000,
      },
    });
    expect(queuedJobs?.[0]?.opts?.jobId).toBe(body.jobId);
    expect(queuedJobs?.[0]?.opts?.jobId).toMatch(/^sheets-manual\./);
    expect(queuedJobs?.[0]?.opts?.jobId).not.toContain(":");
    expect(queuedJobs?.[1]?.opts?.jobId).toMatch(/^sheets-manual\./);
    expect(queuedJobs?.[1]?.opts?.jobId).not.toContain(":");
    expect(queuedJobs?.[1]?.opts?.jobId).not.toBe(queuedJobs?.[0]?.opts?.jobId);
  });

  it("queues manual sync jobs with colon-free ids for colon-containing source ids", async () => {
    mocks.getFormIntegration.mockResolvedValueOnce({
      ...configuredIntegration("form-1"),
      id: "integration:one",
    });
    mocks.responseRows = [{ responseId: "response:one" }];

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ force: true }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const queuedJobs = mocks.addBulk.mock.calls[0]?.[0];
    expect(queuedJobs?.[0]?.opts?.jobId).toBe(body.jobId);
    expect(body.jobId).toMatch(/^sheets-manual\./);
    expect(body.jobId).not.toContain(":");
  });

  it("uses the same manual sync job id for consecutive syncs of the same response", async () => {
    mocks.responseRows = [{ responseId: "response-1" }];

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const firstResponse = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ force: true }),
      },
    );
    const firstBody = await firstResponse.json();

    const retryResponse = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ force: true }),
      },
    );
    const retryBody = await retryResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    expect(firstBody).toMatchObject({
      jobId: expect.stringMatching(/^sheets-manual\./),
      status: "queued",
    });
    expect(retryBody).toMatchObject({
      jobId: expect.stringMatching(/^sheets-manual\./),
      status: "queued",
    });
    expect(retryBody.jobId).toBe(firstBody.jobId);
    expect(mocks.addBulk).toHaveBeenCalledTimes(2);
    expect(mocks.addBulk.mock.calls[1]?.[0]?.[0]?.opts?.jobId).toBe(
      firstBody.jobId,
    );
  });

  it("defaults manual sync to the latest response instead of replaying all rows", async () => {
    mocks.responseRows = [
      { responseId: "latest-response" },
      { responseId: "older-response" },
    ];

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(200);
    const queuedJobs = mocks.addBulk.mock.calls[0]?.[0];
    expect(queuedJobs).toHaveLength(1);
    expect(queuedJobs?.[0]?.data.responseId).toBe("latest-response");
  });

  it("rejects full manual sync when the response count exceeds the queueing limit", async () => {
    mocks.responseRows = Array.from({ length: 1001 }, (_, index) => ({
      responseId: `response-${index}`,
    }));

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ force: true }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toEqual({
      error:
        "Full manual sync is limited to 1000 responses; retry without force to sync the latest response only",
    });
    expect(mocks.addBulk).not.toHaveBeenCalled();
  });

  it("allows full manual sync at exactly the response queueing limit", async () => {
    mocks.responseRows = Array.from({ length: 1000 }, (_, index) => ({
      responseId: `response-${index}`,
    }));

    const { formsIntegrationsRouter } = await import(
      "../routes/forms-integrations"
    );
    const response = await formsIntegrationsRouter.request(
      "/form-1/integrations/google-sheets/sync",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ force: true }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.addBulk).toHaveBeenCalledTimes(1);
    expect(mocks.addBulk.mock.calls[0]?.[0]).toHaveLength(1000);
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
