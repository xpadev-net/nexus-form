#!/usr/bin/env tsx
import {
  type BlockTypeValue,
  toPlateQuestionType,
} from "../packages/shared/src/forms/form-block";
import {
  responsePayloadItemSchema,
  type ResponseDataItem,
} from "../packages/shared/src/response-data";
import {
  isAnswerableFixtureBlockType,
  parseStoryFixtureSet,
  STORY_FIXTURE_PREFIX,
  STORY_FIXTURE_PREFIX_MIN_LENGTH,
  type StoryFixture,
  type StoryFixtureBlock,
  type StoryFixtureSet,
  type StoryFixtureStructure,
} from "../packages/shared/src/validation/story-fixture";

type Action = "generate" | "cleanup";
type FixtureEnvironment = "local" | "staging";

const NO_CHANGES_TO_PUBLISH_FRAGMENT = "No changes to publish";
const NO_CHANGES_TO_PUBLISH_CODE = "NO_CHANGES_TO_PUBLISH";

interface CliOptions {
  action: Action;
  dryRun: boolean;
  sampleResponses: boolean;
  env: FixtureEnvironment;
  apiUrl: string;
  webUrl: string;
  prefix: string;
  apiToken?: string;
  confirmCleanup?: string;
  confirmStaging: boolean;
}

interface FormRow {
  id: string;
  publicId: string;
  title: string;
  description: string | null;
  status: string;
  plateContentVersion: number;
}

interface GeneratedRow {
  story: string;
  formId: string;
  publicUrl: string;
  responseIds: string[];
  verificationTargets: string[];
}

interface StructureEnvelope {
  structure: StoryFixtureStructure;
}

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly responseBody: string,
  ) {
    super(`API ${status} ${path}: ${responseBody}`);
    this.name = "ApiError";
  }
}

class ApiClient {
  private readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    this.baseUrl = new URL(baseUrl);
  }

  async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new ApiError(response.status, path, text);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}

function parseArgs(argv: string[]): CliOptions {
  const flags = new Map<string, string | true>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown positional argument: ${arg}`);
    }
    const [key, value] = arg.slice(2).split("=", 2);
    if (!key) throw new Error(`Invalid argument: ${arg}`);
    flags.set(key, value ?? true);
  }

  const action = flags.has("cleanup") ? "cleanup" : "generate";
  const envValue =
    getStringFlag(flags, "env") ??
    process.env.NEXUS_FORM_FIXTURE_ENV ??
    "local";
  if (envValue !== "local" && envValue !== "staging") {
    throw new Error("--env must be local or staging");
  }

  const defaultPrefix = `${STORY_FIXTURE_PREFIX} 2026-06-04`;
  const prefix =
    getStringFlag(flags, "prefix") ??
    process.env.NEXUS_FORM_FIXTURE_PREFIX ??
    defaultPrefix;

  return {
    action,
    dryRun: flags.has("dry-run"),
    sampleResponses: flags.has("sample-responses"),
    env: envValue,
    apiUrl:
      getStringFlag(flags, "api-url") ??
      process.env.NEXUS_FORM_API_URL ??
      "http://localhost:3001",
    webUrl:
      getStringFlag(flags, "web-url") ??
      process.env.NEXUS_FORM_WEB_URL ??
      "http://localhost:3000",
    prefix,
    apiToken: process.env.NEXUS_FORM_API_TOKEN,
    confirmCleanup: getStringFlag(flags, "confirm-cleanup"),
    confirmStaging:
      flags.has("confirm-staging") ||
      process.env.NEXUS_FORM_CONFIRM_STAGING === "true",
  };
}

function getStringFlag(
  flags: Map<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function assertSafeOptions(options: CliOptions): void {
  if (!options.prefix.startsWith(STORY_FIXTURE_PREFIX)) {
    throw new Error(`Prefix must start with "${STORY_FIXTURE_PREFIX}"`);
  }
  if (options.prefix.length < STORY_FIXTURE_PREFIX_MIN_LENGTH) {
    throw new Error(
      "Prefix must include an explicit run marker, for example a date",
    );
  }

  const api = new URL(options.apiUrl);
  const hostname = api.hostname.toLowerCase();
  const isLocalhost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (options.env === "local" && !isLocalhost) {
    throw new Error("--env local only permits localhost API targets");
  }
  if (options.env === "staging") {
    if (!options.confirmStaging) {
      throw new Error("Staging generation requires --confirm-staging");
    }
    if (!hostname.includes("staging") && !hostname.includes("stage")) {
      throw new Error("Staging API hostname must include staging or stage");
    }
  }
  if (
    options.action === "cleanup" &&
    options.confirmCleanup !== options.prefix
  ) {
    throw new Error(
      `Cleanup requires --confirm-cleanup="${options.prefix}" to avoid accidental deletion`,
    );
  }
  if ((!options.dryRun || options.action === "cleanup") && !options.apiToken) {
    throw new Error(
      "NEXUS_FORM_API_TOKEN is required outside generate --dry-run",
    );
  }
}

const optionSet = [
  { id: "opt_yes", label: "Yes" },
  { id: "opt_no", label: "No" },
  { id: "opt_follow_up", label: "Follow up" },
];
const gridRows = [
  { id: "row_a", label: "Row A" },
  { id: "row_b", label: "Row B" },
];
const gridColumns = [
  { id: "col_good", label: "Good" },
  { id: "col_ok", label: "OK" },
  { id: "col_review", label: "Needs review" },
];

function block(
  story: string,
  suffix: string,
  type: BlockTypeValue,
  title: string,
  validation: Record<string, unknown> = {},
): StoryFixtureBlock {
  return {
    blockId: `${story.toLowerCase()}-${suffix}`,
    type,
    title,
    validation: {
      type,
      required: true,
      ...validation,
    },
  };
}

function sampleResponse(blockItem: StoryFixtureBlock): ResponseDataItem | null {
  if (!isAnswerableFixtureBlockType(blockItem.type)) return null;
  const base = {
    question_id: blockItem.blockId,
    question_type: blockItem.type,
    question_title: blockItem.title,
  };

  switch (blockItem.type) {
    case "short_text":
      return { ...base, value: `Sample ${blockItem.blockId}` };
    case "long_text":
      return { ...base, value: `Long sample response for ${blockItem.title}` };
    case "radio":
    case "dropdown":
      return { ...base, value: firstOptionId(blockItem) };
    case "checkbox":
      return { ...base, values: [firstOptionId(blockItem)] };
    case "linear_scale":
      return { ...base, value: 4 };
    case "rating":
      return { ...base, value: 5 };
    case "choice_grid": {
      const rows = "rows" in blockItem.validation ? blockItem.validation.rows : [];
      const columnId =
        "columns" in blockItem.validation
          ? blockItem.validation.columns[0]?.id
          : undefined;
      if (!columnId) return null;
      return {
        ...base,
        responses: Object.fromEntries(
          rows.map((row) => [row.id, columnId]),
        ),
      };
    }
    case "checkbox_grid": {
      const rows = "rows" in blockItem.validation ? blockItem.validation.rows : [];
      const columnId =
        "columns" in blockItem.validation
          ? blockItem.validation.columns[0]?.id
          : undefined;
      if (!columnId) return null;
      return {
        ...base,
        responses: Object.fromEntries(
          rows.map((row) => [row.id, [columnId]]),
        ),
      };
    }
    case "date":
      return { ...base, value: "2026-06-04" };
    case "time":
      return { ...base, value: "10:30" };
    case "section_separator":
      return null;
  }
}

function firstOptionId(blockItem: StoryFixtureBlock): string {
  return "options" in blockItem.validation
    ? (blockItem.validation.options[0]?.id ?? "opt_yes")
    : "opt_yes";
}

function story(
  prefix: string,
  index: number,
  scenario: {
    summary: string;
    targets: string[];
    blocks: StoryFixtureBlock[];
    structure?: Partial<StoryFixture["structure"]>;
  },
): StoryFixture {
  const storyId = `S${String(index).padStart(2, "0")}`;
  const sampleResponses = scenario.blocks
    .map(sampleResponse)
    .filter((response): response is ResponseDataItem => response !== null);

  return {
    story: storyId,
    title: `${prefix} ${storyId}`,
    description: scenario.summary,
    verificationTargets: scenario.targets,
    blocks: scenario.blocks,
    structure: {
      version: 1,
      settings: {
        allow_edit_responses: false,
        require_fingerprint: false,
      },
      ...scenario.structure,
    },
    sampleResponses,
  };
}

function buildFixtureSet(prefix: string): StoryFixtureSet {
  const allQuestionBlocks = [
    block("s01", "short", "short_text", "Short text", {
      minLength: 2,
      maxLength: 100,
    }),
    block("s01", "long", "long_text", "Long text", { maxLength: 500 }),
    block("s01", "radio", "radio", "Radio choice", { options: optionSet }),
    block("s01", "checkbox", "checkbox", "Checkbox choice", {
      options: optionSet,
      minSelections: 1,
      maxSelections: 2,
    }),
    block("s01", "dropdown", "dropdown", "Dropdown choice", {
      options: optionSet,
    }),
    block("s01", "scale", "linear_scale", "Linear scale", {
      min: 1,
      max: 5,
      step: 1,
    }),
    block("s01", "rating", "rating", "Rating", { maxRating: 5 }),
    block("s01", "choice-grid", "choice_grid", "Choice grid", {
      rows: gridRows,
      columns: gridColumns,
    }),
    block("s01", "checkbox-grid", "checkbox_grid", "Checkbox grid", {
      rows: gridRows,
      columns: gridColumns,
      minSelectionsPerRow: 1,
      maxSelectionsPerRow: 2,
    }),
    block("s01", "date", "date", "Date", {
      minDate: "2026-06-01",
      maxDate: "2026-06-30",
    }),
    block("s01", "time", "time", "Time", {
      minTime: "09:00",
      maxTime: "18:00",
    }),
    block("s01", "section", "section_separator", "Section break", {
      required: false,
    }),
  ];

  const scenarios = [
    {
      summary: "All major question types and public submission coverage",
      targets: ["S01/S23/S24 all question submit", "response detail"],
      blocks: allQuestionBlocks,
    },
    {
      summary: "Post-submit confirmation title/message/link/contact/ID",
      targets: ["confirmation snapshot", "response ID exposure"],
      blocks: [block("s02", "name", "short_text", "Respondent name")],
      structure: {
        confirmation: {
          title: "QA fixture submitted",
          message: "Your Codex Story QA response was recorded.",
          supplemental_link: {
            label: "QA checklist",
            url: "https://example.com/qa-checklist",
          },
          contact: {
            label: "QA contact",
            email: "qa@example.com",
          },
          show_response_id: true,
        },
      },
    },
    {
      summary: "Password protected public form",
      targets: ["password gate", "published snapshot access control"],
      blocks: [block("s03", "secret", "short_text", "Protected answer")],
    },
    {
      summary: "Responses search empty/loading/error states",
      targets: ["responses search", "pagination", "empty state"],
      blocks: [
        block("s04", "search", "short_text", "Searchable keyword"),
        block("s04", "notes", "long_text", "Searchable notes"),
      ],
    },
    {
      summary: "CSV export loading/success/error/sanitize",
      targets: ["CSV export", "HTML error sanitize"],
      blocks: [
        block("s05", "csv-text", "short_text", "CSV text"),
        block("s05", "csv-choice", "radio", "CSV choice", {
          options: optionSet,
        }),
      ],
    },
    {
      summary: "Public URL regeneration and copy surface",
      targets: ["public URL regeneration", "copy action", "old URL invalid"],
      blocks: [block("s06", "url", "short_text", "URL smoke answer")],
    },
    {
      summary: "Share link VIEWER/EDITOR and collaborator permission",
      targets: ["share link roles", "collaborator permission"],
      blocks: [block("s07", "share", "short_text", "Share QA answer")],
    },
    {
      summary: "Google Sheets integration manual sync fixture",
      targets: ["Sheets selector", "manual sync", "job status"],
      blocks: [block("s08", "sheet", "short_text", "Sheet row value")],
    },
    {
      summary: "Duplicate/archive destructive action feedback",
      targets: ["duplicate", "archive", "restore"],
      blocks: [block("s09", "duplicate", "short_text", "Duplicate answer")],
    },
    {
      summary: "Prefill generator supported and unsupported guidance",
      targets: ["prefill URL", "unsupported question guidance"],
      blocks: [
        block("s10", "prefill-text", "short_text", "Prefill text"),
        block("s10", "prefill-date", "date", "Prefill date"),
      ],
    },
    {
      summary: "Schedule status and retry/recovery actions",
      targets: ["schedule manager", "snapshot switch"],
      blocks: [block("s11", "schedule", "short_text", "Schedule answer")],
    },
    {
      summary: "Appearance preview and public snapshot rendering",
      targets: ["appearance settings", "question numbers", "contrast warning"],
      blocks: [block("s12", "appearance", "rating", "Appearance rating")],
    },
    {
      summary: "Public choice labels and grid accessible names",
      targets: ["choice labels", "grid accessible names"],
      blocks: [
        block("s13", "choice", "radio", "Duplicate label choice", {
          options: [
            { id: "choice_a", label: "Same label" },
            { id: "choice_b", label: "Same label" },
          ],
        }),
        block("s13", "grid", "choice_grid", "Accessible grid", {
          rows: gridRows,
          columns: gridColumns,
        }),
      ],
    },
    {
      summary: "Submit completion avoids double-send and stale required errors",
      targets: ["double submit guard", "required error reset"],
      blocks: [block("s14", "required", "short_text", "Required answer")],
    },
    {
      summary: "Password protection does not mix draft and active snapshot",
      targets: ["active snapshot access control", "draft/published separation"],
      blocks: [block("s15", "snapshot", "short_text", "Snapshot answer")],
    },
    {
      summary: "Response ID exposure can be toggled",
      targets: ["show_response_id true/false", "post-submit settings"],
      blocks: [block("s16", "response-id", "short_text", "ID answer")],
      structure: {
        confirmation: {
          title: "Response ID QA",
          message: "Toggle show_response_id in settings for this fixture.",
          show_response_id: true,
        },
      },
    },
    {
      summary: "Submit notification enqueue does not block successful submit",
      targets: ["submit notification enqueue", "fail-open behavior"],
      blocks: [block("s17", "notify", "short_text", "Notification answer")],
    },
    {
      summary: "Grid analytics for 1x1, multi-row, and invalid payload notice",
      targets: ["grid analytics", "chart rendering", "invalid payload notice"],
      blocks: [
        block("s18", "analytics-choice", "choice_grid", "Analytics grid", {
          rows: gridRows,
          columns: gridColumns,
        }),
        block(
          "s18",
          "analytics-checkbox",
          "checkbox_grid",
          "Checkbox analytics grid",
          {
            rows: gridRows,
            columns: gridColumns,
          },
        ),
      ],
    },
    {
      summary: "Mock external validation provider success/failure/retry",
      targets: ["mock validation provider", "Queue/SSE", "retry"],
      blocks: [block("s19", "validation", "short_text", "Validation subject")],
    },
    {
      summary: "Response detail validation results and failure reasons",
      targets: ["response detail", "validation result list", "retry/cancel"],
      blocks: [block("s20", "detail", "short_text", "Detail answer")],
    },
    {
      summary: "Date required and range state",
      targets: ["date required", "date range", "page navigation"],
      blocks: [
        block("s21", "date-range", "date", "Date in range", {
          minDate: "2026-06-01",
          maxDate: "2026-06-30",
        }),
      ],
    },
    {
      summary: "Publish snapshot copy and version clarity",
      targets: ["publish menu copy", "snapshot history"],
      blocks: [block("s22", "publish", "short_text", "Publish answer")],
    },
    {
      summary: "All-question fixture Web component coverage",
      targets: [
        "FormBody all question rendering",
        "section separator excluded",
      ],
      blocks: [
        block("s23", "web-short", "short_text", "Web short"),
        block("s23", "web-choice", "dropdown", "Web dropdown", {
          options: optionSet,
        }),
      ],
    },
    {
      summary: "All-question fixture API submit coverage",
      targets: ["public submit API", "invalid patch table"],
      blocks: [
        block("s24", "api-short", "short_text", "API short"),
        block("s24", "api-rating", "rating", "API rating", { maxRating: 5 }),
      ],
    },
    {
      summary: "Confirmation fixture API and UI coverage",
      targets: ["completion screen", "settings payload", "response ID"],
      blocks: [block("s25", "complete", "short_text", "Completion answer")],
      structure: {
        confirmation: {
          title: "Completion QA",
          message: "Completion fixture for API/UI coverage.",
          show_response_id: true,
        },
      },
    },
    {
      summary: "Access control fixture API and UI coverage",
      targets: ["password settings", "locked body", "verified cookie"],
      blocks: [block("s26", "access", "short_text", "Access answer")],
    },
    {
      summary: "Share link fixture API and UI coverage",
      targets: ["VIEWER link", "EDITOR link", "clipboard fallback"],
      blocks: [block("s27", "link", "short_text", "Share link answer")],
    },
    {
      summary: "Sheets dedicated fixture API and UI coverage",
      targets: ["QA Sheet row", "manual sync job", "auth status"],
      blocks: [block("s28", "sheet-ui", "short_text", "Sheets UI answer")],
    },
    {
      summary: "CSV and analytics output saved-value fixture",
      targets: ["CSV artifact", "analytics screenshot", "same response set"],
      blocks: [
        block("s29", "output-text", "short_text", "Output text"),
        block("s29", "output-grid", "choice_grid", "Output grid", {
          rows: gridRows,
          columns: gridColumns,
        }),
      ],
    },
    {
      summary: "Safe QA environment and manual evidence operation",
      targets: ["redaction checklist", "safe cleanup", "manual evidence"],
      blocks: [block("s30", "safe", "short_text", "Safe QA answer")],
    },
  ];

  return parseStoryFixtureSet({
    prefix,
    stories: scenarios.map((scenario, index) =>
      story(prefix, index + 1, scenario),
    ),
  });
}

function buildPlateContent(fixture: StoryFixture): string {
  const nodes = [
    {
      type: "h1",
      children: [{ text: fixture.title }],
    },
    {
      type: "p",
      children: [{ text: fixture.description ?? "" }],
    },
    ...fixture.blocks.map((blockItem) => ({
      type: toPlateQuestionType(blockItem.type),
      nodeId: blockItem.blockId,
      blockId: blockItem.blockId,
      validation: blockItem.validation,
      children: [
        {
          type: "h2",
          children: [{ text: blockItem.title }],
        },
        {
          type: "p",
          children: [{ text: blockItem.description ?? "" }],
        },
      ],
    })),
  ];

  return JSON.stringify(nodes);
}

function publicUrl(webUrl: string, publicId: string): string {
  return new URL(`/forms/public/${publicId}`, webUrl).toString();
}

async function listForms(client: ApiClient): Promise<FormRow[]> {
  const all: FormRow[] = [];
  let page = 1;
  while (true) {
    const response = await client.request<{
      forms: FormRow[];
      pagination: { totalPages: number };
    }>(`/api/forms?page=${page}&limit=200`);
    all.push(...response.forms);
    if (page >= response.pagination.totalPages) return all;
    page += 1;
  }
}

async function ensureForm(
  client: ApiClient,
  fixture: StoryFixture,
  existingByTitle: Map<string, FormRow>,
): Promise<FormRow> {
  const existing = existingByTitle.get(fixture.title);
  if (existing) {
    const updated = await client.request<{ form: FormRow }>(
      `/api/forms/${existing.id}`,
      {
        method: "PUT",
        body: {
          title: fixture.title,
          description: fixture.description ?? null,
        },
      },
    );
    return updated.form;
  }

  const created = await client.request<{ form: FormRow }>("/api/forms", {
    method: "POST",
    body: {
      title: fixture.title,
      description: fixture.description,
    },
  });
  return created.form;
}

async function saveContent(
  client: ApiClient,
  formId: string,
  plateContent: string,
): Promise<void> {
  const current = await client.request<{
    plateContent: string;
    plateContentVersion: number;
  }>(`/api/forms/${formId}/content`);

  if (current.plateContent === plateContent) return;

  await client.request(`/api/forms/${formId}/content`, {
    method: "PUT",
    body: {
      plateContent,
      expectedVersion: current.plateContentVersion,
    },
  });
}

async function saveStructure(
  client: ApiClient,
  fixture: StoryFixture,
  formId: string,
): Promise<void> {
  const needsPassword = ["S03", "S15", "S26"].includes(fixture.story);
  const current = await getStructure(client, formId);
  let structure = fixture.structure;
  let passwordAlreadyConfigured = false;
  if (needsPassword) {
    const currentPassword =
      current?.structure.access_control?.password_protection;
    if (
      currentPassword?.enabled === true &&
      currentPassword.has_password === true &&
      currentPassword.password_hint === "codex-story-qa"
    ) {
      passwordAlreadyConfigured = true;
      structure = {
        ...fixture.structure,
        access_control: {
          require_authentication:
            fixture.structure.access_control?.require_authentication ?? false,
          password_protection: {
            enabled: true,
            has_password: true,
            password_hint: "codex-story-qa",
          },
        },
      };
    }
  }

  if (
    current &&
    stableStringify(current.structure) === stableStringify(structure)
  ) {
    if (!needsPassword || passwordAlreadyConfigured) return;
  } else {
    await client.request(`/api/forms/${formId}/structure`, {
      method: "PUT",
      body: {
        structure,
        changeLog: `Apply ${fixture.story} story QA fixture`,
      },
    });
  }

  if (needsPassword) {
    const refreshed = await getStructure(client, formId);
    const currentPassword =
      refreshed?.structure.access_control?.password_protection;
    if (
      currentPassword?.enabled === true &&
      currentPassword.has_password === true &&
      currentPassword.password_hint === "codex-story-qa"
    ) {
      return;
    }

    await client.request(`/api/forms/${formId}/structure/access-control`, {
      method: "PATCH",
      body: {
        password_protection: {
          enabled: true,
          password: "codex-story-qa",
          password_hint: "codex-story-qa",
        },
      },
    });
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeStableValue(value)) ?? "undefined";
}

function normalizeStableValue(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : normalizeStableValue(item),
    );
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
    .sort()
      .map((key) => [key, normalizeStableValue(record[key])]),
  );
}

async function getStructure(
  client: ApiClient,
  formId: string,
): Promise<StructureEnvelope | null> {
  try {
    return await client.request<StructureEnvelope>(
      `/api/forms/${formId}/structure`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function isNoChangesToPublish(error: ApiError): boolean {
  try {
    const parsed = JSON.parse(error.responseBody) as { code?: unknown };
    return parsed.code === NO_CHANGES_TO_PUBLISH_CODE;
  } catch {
    return error.responseBody.includes(NO_CHANGES_TO_PUBLISH_FRAGMENT);
  }
}

async function publish(
  client: ApiClient,
  formId: string,
  storyId: string,
): Promise<void> {
  let createdVersion: number | null = null;
  try {
    const snapshot = await client.request<{
      version: number;
      publishedAt: string;
    }>(`/api/forms/${formId}/snapshots`, {
      method: "POST",
      body: {
        changeLog: `Publish ${storyId} story QA fixture`,
      },
    });
    createdVersion = snapshot.version;
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 400 &&
      isNoChangesToPublish(error)
    ) {
      createdVersion = null;
    } else {
      throw error;
    }
  }

  if (createdVersion !== null) {
    await client.request(
      `/api/forms/${formId}/snapshots/${createdVersion}/activate`,
      {
        method: "POST",
      },
    );
  }

  await client.request(`/api/forms/${formId}/publish`, {
    method: "POST",
  });
}

async function ensureSampleResponses(
  client: ApiClient,
  formId: string,
  fixture: StoryFixture,
): Promise<string[]> {
  if (!fixture.sampleResponses || fixture.sampleResponses.length === 0)
    return [];
  const respondentUuid = `codex-story-qa:${fixture.story}`;
  const existingIds = await listFixtureResponseIds(
    client,
    formId,
    respondentUuid,
  );
  if (existingIds.length > 0) {
    const [primaryId, ...duplicateIds] = existingIds;
    if (!primaryId) return [];

    const detail = await client.request<{
      response: { responseDataJson: string };
    }>(`/api/forms/${formId}/responses/${primaryId}`);
    const currentResponses = parseStoredResponseDataJson(
      detail.response.responseDataJson,
    );
    if (
      !currentResponses ||
      stableStringify(currentResponses) !==
        stableStringify(fixture.sampleResponses)
    ) {
      await client.request(`/api/forms/${formId}/responses/${primaryId}`, {
        method: "PUT",
        body: {
          responses: fixture.sampleResponses,
        },
      });
    }

    for (const duplicateId of duplicateIds) {
      await client.request(`/api/forms/${formId}/responses/${duplicateId}`, {
        method: "DELETE",
      });
    }

    return [primaryId];
  }

  const created = await client.request<{
    response: { id: string } | null;
  }>(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      responses: fixture.sampleResponses,
      respondentUuid,
      userAgent: "codex-story-fixture-generator",
    },
  });

  return created.response ? [created.response.id] : [];
}

async function listFixtureResponseIds(
  client: ApiClient,
  formId: string,
  respondentUuid: string,
): Promise<string[]> {
  const ids: string[] = [];
  const limit = 100;
  let page = 1;
  while (true) {
    const response = await client.request<{
      responses: Array<{ id: string; respondentUuid: string }>;
      hasNext: boolean;
    }>(
      `/api/forms/${formId}/responses?q=${encodeURIComponent(respondentUuid)}&page=${page}&limit=${limit}`,
    );
    ids.push(
      ...response.responses
        .filter((item) => item.respondentUuid === respondentUuid)
        .map((item) => item.id),
    );
    if (!response.hasNext) break;
    page += 1;
  }
  return ids;
}

function parseStoredResponseDataJson(json: string): ResponseDataItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = responsePayloadItemSchema.array().safeParse(parsed);
  return result.success ? result.data : null;
}

async function generate(
  options: CliOptions,
  fixtureSet: StoryFixtureSet,
): Promise<void> {
  if (options.dryRun) {
    printRows(
      fixtureSet.stories.map((fixture) => ({
        story: fixture.story,
        formId: "(dry-run)",
        publicUrl: "(dry-run)",
        responseIds: options.sampleResponses ? ["(dry-run)"] : [],
        verificationTargets: fixture.verificationTargets,
      })),
    );
    return;
  }

  const client = new ApiClient(options.apiUrl, requiredToken(options));
  const existingForms = await listForms(client);
  const existingByTitle = new Map(
    existingForms.map((form) => [form.title, form]),
  );
  const rows: GeneratedRow[] = [];

  for (const fixture of fixtureSet.stories) {
    const formRow = await ensureForm(client, fixture, existingByTitle);
    existingByTitle.set(fixture.title, formRow);
    await saveContent(client, formRow.id, buildPlateContent(fixture));
    await saveStructure(client, fixture, formRow.id);
    await publish(client, formRow.id, fixture.story);
    const responseIds = options.sampleResponses
      ? await ensureSampleResponses(client, formRow.id, fixture)
      : [];

    rows.push({
      story: fixture.story,
      formId: formRow.id,
      publicUrl: publicUrl(options.webUrl, formRow.publicId),
      responseIds,
      verificationTargets: fixture.verificationTargets,
    });
  }

  printRows(rows);
}

async function cleanup(
  options: CliOptions,
  _fixtureSet: StoryFixtureSet,
): Promise<void> {
  const client = new ApiClient(options.apiUrl, requiredToken(options));
  const forms = await listForms(client);
  const targets = forms.filter((form) => form.title.startsWith(options.prefix));
  printCleanupRows(targets);

  if (options.dryRun) return;

  for (const target of targets) {
    await client.request(`/api/forms/${target.id}`, {
      method: "DELETE",
    });
  }
}

function requiredToken(options: CliOptions): string {
  if (!options.apiToken) {
    throw new Error("NEXUS_FORM_API_TOKEN is required");
  }
  return options.apiToken;
}

function printRows(rows: GeneratedRow[]): void {
  console.log(
    [
      "story\tformId\tpublicUrl\tresponseIds\tverificationTargets",
      ...rows.map((row) =>
        [
          row.story,
          row.formId,
          row.publicUrl,
          row.responseIds.join(",") || "-",
          row.verificationTargets.join("; "),
        ].join("\t"),
      ),
    ].join("\n"),
  );
}

function printCleanupRows(rows: Array<{ id: string; title: string }>): void {
  console.log(
    [
      "cleanupTargetId\ttitle",
      ...rows.map((row) => [row.id, row.title].join("\t")),
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  assertSafeOptions(options);
  const fixtureSet = buildFixtureSet(options.prefix);

  if (options.action === "cleanup") {
    await cleanup(options, fixtureSet);
    return;
  }

  await generate(options, fixtureSet);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
