import {
  FORM_STATUS_VALUES,
  VALIDATION_STATUS_VALUES,
} from "@nexus-form/shared";
import { relations } from "drizzle-orm";
import {
  boolean,
  float,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { user } from "./auth-schema";

// ── Enums ───────────────────────────────────────────────────────────

export const formStatusEnum = mysqlEnum("form_status", FORM_STATUS_VALUES);

export const formPermissionRoleEnum = mysqlEnum("form_permission_role", [
  "OWNER",
  "EDITOR",
  "VIEWER",
]);

export const formShareRoleEnum = mysqlEnum("form_share_role", [
  "EDITOR",
  "VIEWER",
]);

export const apiTokenTypeEnum = mysqlEnum("api_token_type", [
  "USER",
  "FORM",
  "SHARE_LINK",
]);

export const inviteStatusEnum = mysqlEnum("invite_status", [
  "PENDING",
  "ACCEPTED",
  "EXPIRED",
  "CANCELLED",
]);

export const telemetryVersionEnum = mysqlEnum("telemetry_version", [
  "V4",
  "V6",
]);

export const dataSubjectRequestTypeEnum = mysqlEnum(
  "data_subject_request_type",
  ["EXPORT", "DELETE"],
);

export const dataSubjectRequestStatusEnum = mysqlEnum(
  "data_subject_request_status",
  ["PENDING", "PROCESSING", "COMPLETED", "REJECTED"],
);

export const validationStatusEnum = mysqlEnum(
  "validation_status",
  VALIDATION_STATUS_VALUES,
);

export const formScheduleActionEnum = mysqlEnum("form_schedule_action", [
  "PUBLISH",
  "UNPUBLISH",
  "SWITCH_SNAPSHOT",
]);

// ── Discord Related ─────────────────────────────────────────────────

export const discordUser = mysqlTable("DiscordUser", {
  id: varchar("id", { length: 128 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  discordUserId: varchar("discordUserId", { length: 255 }).notNull().unique(),
  avatarUrl: varchar("avatarUrl", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const discordGuild = mysqlTable(
  "DiscordGuild",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    guildId: varchar("guildId", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    iconUrl: varchar("iconUrl", { length: 512 }),
    discordUserId: varchar("discordUserId", { length: 255 })
      .notNull()
      .references(() => discordUser.discordUserId, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("DiscordGuild_discordUserId_guildId_key").on(
      table.discordUserId,
      table.guildId,
    ),
    index("DiscordGuild_discordUserId_idx").on(table.discordUserId),
    index("DiscordGuild_guildId_idx").on(table.guildId),
  ],
);

// ── Form ────────────────────────────────────────────────────────────

export const form = mysqlTable(
  "Form",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    publicId: varchar("publicId", { length: 255 }).notNull().unique(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    creatorId: varchar("creatorId", { length: 191 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: formStatusEnum.default("DRAFT").notNull(),
    publishedAt: timestamp("publishedAt"),
    unpublishedAt: timestamp("unpublishedAt"),
    allowEditResponses: boolean("allowEditResponses").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    version: int("version").default(1).notNull(),
    plateContent: longtext("plateContent"),
    plateContentVersion: int("plateContentVersion").default(0).notNull(),
    baseSnapshotVersion: int("baseSnapshotVersion"),
  },
  (table) => [
    index("Form_creatorId_idx").on(table.creatorId),
    index("Form_status_idx").on(table.status),
    index("Form_title_idx").on(table.title),
    index("Form_creatorId_status_idx").on(table.creatorId, table.status),
    index("Form_updatedAt_idx").on(table.updatedAt),
    index("Form_publicId_idx").on(table.publicId),
  ],
);

// ── Form Schedule ───────────────────────────────────────────────────

export const formSchedule = mysqlTable(
  "FormSchedule",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    formId: varchar("formId", { length: 128 })
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    triggerAt: timestamp("triggerAt").notNull(),
    action: formScheduleActionEnum.notNull(),
    snapshotVersion: int("snapshotVersion"),
    processedAt: timestamp("processedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("FormSchedule_formId_idx").on(table.formId),
    index("FormSchedule_triggerAt_idx").on(table.triggerAt),
    index("FormSchedule_action_idx").on(table.action),
    index("FormSchedule_processedAt_idx").on(table.processedAt),
    index("FormSchedule_formId_processedAt_idx").on(
      table.formId,
      table.processedAt,
    ),
  ],
);

// ── API Token ───────────────────────────────────────────────────────

export const apiToken = mysqlTable(
  "ApiToken",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    userId: varchar("userId", { length: 191 }).references(() => user.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    tokenHash: varchar("tokenHash", { length: 255 }).notNull().unique(),
    lookupHash: varchar("lookupHash", { length: 64 }),
    scopes: json("scopes").notNull(),
    formIds: json("formIds"),
    type: apiTokenTypeEnum.default("USER").notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    expiresAt: timestamp("expiresAt"),
    lastUsedAt: timestamp("lastUsedAt"),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    shareLinkId: varchar("shareLinkId", { length: 128 }).references(
      () => formShareLink.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    index("ApiToken_userId_idx").on(table.userId),
    index("ApiToken_isActive_idx").on(table.isActive),
    index("ApiToken_type_idx").on(table.type),
    index("ApiToken_lookupHash_idx").on(table.lookupHash),
    index("ApiToken_shareLinkId_idx").on(table.shareLinkId),
  ],
);

// ── Form Permission ─────────────────────────────────────────────────

export const formPermission = mysqlTable(
  "FormPermission",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    formId: varchar("formId", { length: 128 })
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    userId: varchar("userId", { length: 191 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: formPermissionRoleEnum.notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("FormPermission_formId_userId_key").on(
      table.formId,
      table.userId,
    ),
    index("FormPermission_userId_idx").on(table.userId),
    index("FormPermission_formId_idx").on(table.formId),
  ],
);

// ── Form Share Link ─────────────────────────────────────────────────

export const formShareLink = mysqlTable(
  "FormShareLink",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    formId: varchar("formId", { length: 128 })
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 255 }).notNull().unique(),
    role: formShareRoleEnum.notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    createdBy: varchar("createdBy", { length: 191 }).references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("FormShareLink_formId_idx").on(table.formId),
    index("FormShareLink_isActive_idx").on(table.isActive),
    index("FormShareLink_expiresAt_idx").on(table.expiresAt),
    index("FormShareLink_createdBy_idx").on(table.createdBy),
  ],
);

// ── Form Integration ────────────────────────────────────────────────

export const formIntegration = mysqlTable(
  "FormIntegration",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    formId: varchar("form_id", { length: 128 })
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    configJson: text("config_json").notNull(),
    ownerUserId: varchar("owner_user_id", { length: 191 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 191 }).references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("FormIntegration_formId_key").on(table.formId),
    index("FormIntegration_formId_idx").on(table.formId),
  ],
);

// ── Form Invitation ─────────────────────────────────────────────────

export const formInvitation = mysqlTable(
  "FormInvitation",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    formId: varchar("formId", { length: 128 })
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: formPermissionRoleEnum.notNull(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    status: inviteStatusEnum.default("PENDING").notNull(),
    message: text("message"),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    invitedBy: varchar("invitedBy", { length: 191 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("FormInvitation_formId_email_key").on(
      table.formId,
      table.email,
    ),
    index("FormInvitation_formId_idx").on(table.formId),
    index("FormInvitation_email_idx").on(table.email),
    index("FormInvitation_status_idx").on(table.status),
    index("FormInvitation_expiresAt_idx").on(table.expiresAt),
    index("FormInvitation_invitedBy_idx").on(table.invitedBy),
  ],
);

// ── Form Structure ──────────────────────────────────────────────────

export const formStructure = mysqlTable(
  "FormStructure",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    formId: varchar("formId", { length: 128 })
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    structureJson: text("structureJson").notNull(),
    version: int("version").notNull(),
    createdBy: varchar("createdBy", { length: 191 }).references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    changeLog: text("changeLog"),
    parentVersion: int("parentVersion"),
  },
  (table) => [
    index("FormStructure_formId_version_idx").on(table.formId, table.version),
    index("FormStructure_isActive_idx").on(table.isActive),
    index("FormStructure_formId_isActive_version_idx").on(
      table.formId,
      table.isActive,
      table.version,
    ),
    index("FormStructure_formId_isActive_idx").on(table.formId, table.isActive),
    index("FormStructure_createdBy_idx").on(table.createdBy),
  ],
);

// ── Form Response ───────────────────────────────────────────────────

export const formResponse = mysqlTable(
  "FormResponse",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    formId: varchar("formId", { length: 128 })
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    responseDataJson: text("responseDataJson").notNull(),
    submittedAt: timestamp("submittedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").$onUpdate(() => new Date()),
    respondentUuid: varchar("respondentUuid", { length: 255 })
      .notNull()
      .unique(),
    userAgent: varchar("userAgent", { length: 512 }),
    sessionId: varchar("sessionId", { length: 128 }).references(
      () => formSession.id,
      { onDelete: "set null" },
    ),
    countryCode: varchar("countryCode", { length: 10 }),
  },
  (table) => [
    index("FormResponse_formId_idx").on(table.formId),
    index("FormResponse_submittedAt_idx").on(table.submittedAt),
    index("FormResponse_updatedAt_idx").on(table.updatedAt),
    index("FormResponse_formId_submittedAt_id_idx").on(
      table.formId,
      table.submittedAt,
      table.id,
    ),
    index("FormResponse_formId_updatedAt_idx").on(
      table.formId,
      table.updatedAt,
    ),
    index("FormResponse_sessionId_idx").on(table.sessionId),
  ],
);

// ── Fingerprint Detail ──────────────────────────────────────────────

export const fingerprintDetail = mysqlTable(
  "FingerprintDetail",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    responseId: varchar("responseId", { length: 128 })
      .notNull()
      .references(() => formResponse.id, { onDelete: "cascade" }),
    fingerprintType: varchar("fingerprintType", { length: 50 }).notNull(),
    componentName: varchar("componentName", { length: 255 }).notNull(),
    componentValue: text("componentValue").notNull(),
    componentValueHash: varchar("componentValueHash", {
      length: 255,
    }).notNull(),
    confidence: float("confidence"),
    collectedAt: timestamp("collectedAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
  },
  (table) => [
    uniqueIndex(
      "FingerprintDetail_responseId_fingerprintType_componentName_key",
    ).on(table.responseId, table.fingerprintType, table.componentName),
    index("FingerprintDetail_responseId_idx").on(table.responseId),
    index("FingerprintDetail_fingerprintType_idx").on(table.fingerprintType),
    index("FingerprintDetail_componentName_idx").on(table.componentName),
    index("FingerprintDetail_responseId_fingerprintType_idx").on(
      table.responseId,
      table.fingerprintType,
    ),
    index("FingerprintDetail_componentName_confidence_idx").on(
      table.componentName,
      table.confidence,
    ),
    index("FingerprintDetail_expiresAt_idx").on(table.expiresAt),
  ],
);

// ── User Invite ─────────────────────────────────────────────────────

export const userInvite = mysqlTable(
  "UserInvite",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    status: inviteStatusEnum.default("PENDING").notNull(),
    message: text("message"),
    invitedBy: varchar("invitedBy", { length: 191 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    acceptedAt: timestamp("acceptedAt"),
  },
  (table) => [
    index("UserInvite_status_idx").on(table.status),
    index("UserInvite_expiresAt_idx").on(table.expiresAt),
    index("UserInvite_invitedBy_idx").on(table.invitedBy),
  ],
);

// ── Form Block ──────────────────────────────────────────────────────

// ── Form Snapshot ───────────────────────────────────────────────────

export const formSnapshot = mysqlTable(
  "FormSnapshot",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    formId: varchar("formId", { length: 128 })
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    version: int("version").notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    publishedBy: varchar("publishedBy", { length: 191 }).references(
      () => user.id,
      {
        onDelete: "set null",
      },
    ),
    publishedAt: timestamp("publishedAt").defaultNow().notNull(),
    changeLog: text("changeLog"),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    parentVersion: int("parentVersion"),
    plateContent: longtext("plateContent")
      .notNull()
      .$defaultFn(() => "[]"),
    validationRulesJson: text("validationRulesJson")
      .notNull()
      .$defaultFn(() => "[]"),
  },
  (table) => [
    uniqueIndex("FormSnapshot_formId_version_key").on(
      table.formId,
      table.version,
    ),
    index("FormSnapshot_formId_idx").on(table.formId),
    index("FormSnapshot_formId_isActive_idx").on(table.formId, table.isActive),
    index("FormSnapshot_publishedAt_idx").on(table.publishedAt),
    index("FormSnapshot_publishedBy_idx").on(table.publishedBy),
  ],
);

// ── Telemetry Token ─────────────────────────────────────────────────

export const telemetryToken = mysqlTable(
  "TelemetryToken",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    ip: varchar("ip", { length: 255 }).notNull(),
    version: telemetryVersionEnum.notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
  },
  (table) => [
    index("TelemetryToken_ip_idx").on(table.ip),
    index("TelemetryToken_version_idx").on(table.version),
    index("TelemetryToken_usedAt_idx").on(table.usedAt),
    index("TelemetryToken_expiresAt_idx").on(table.expiresAt),
    index("TelemetryToken_ip_version_idx").on(table.ip, table.version),
  ],
);

// ── Google OAuth Token ──────────────────────────────────────────────

export const googleOAuthToken = mysqlTable(
  "GoogleOAuthToken",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    userId: varchar("userId", { length: 191 })
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).default("google").notNull(),
    accessTokenEnc: text("accessTokenEnc").notNull(),
    refreshTokenEnc: text("refreshTokenEnc").notNull(),
    expiryDate: timestamp("expiryDate").notNull(),
    scopes: json("scopes").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("GoogleOAuthToken_userId_idx").on(table.userId)],
);

// ── Data Subject Request ────────────────────────────────────────────

export const dataSubjectRequest = mysqlTable(
  "DataSubjectRequest",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    requestType: dataSubjectRequestTypeEnum.notNull(),
    status: dataSubjectRequestStatusEnum.default("PENDING").notNull(),
    requestedAt: timestamp("requestedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("DataSubjectRequest_email_idx").on(table.email),
    index("DataSubjectRequest_status_idx").on(table.status),
    index("DataSubjectRequest_requestedAt_idx").on(table.requestedAt),
    index("DataSubjectRequest_email_status_idx").on(table.email, table.status),
    index("DataSubjectRequest_status_requestedAt_idx").on(
      table.status,
      table.requestedAt,
    ),
  ],
);

// ── Form Session ────────────────────────────────────────────────────

export const formSession = mysqlTable(
  "FormSession",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    ipHash: varchar("ipHash", { length: 255 }),
    userAgent: text("userAgent"),
    notes: text("notes"),
  },
  (table) => [
    index("FormSession_createdAt_idx").on(table.createdAt),
    index("FormSession_lastSeenAt_idx").on(table.lastSeenAt),
    index("FormSession_ipHash_idx").on(table.ipHash),
  ],
);

// ── Form Validation Rule ────────────────────────────────────────────

export const formValidationRule = mysqlTable(
  "FormValidationRule",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    formId: varchar("formId", { length: 128 })
      .notNull()
      .references(() => form.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    providerName: varchar("providerName", { length: 64 }).notNull(),
    ruleType: varchar("ruleType", { length: 64 }).notNull(),
    configJson: json("configJson").notNull(),
    orderIndex: int("orderIndex").notNull().default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("FVR_formId_idx").on(table.formId),
    index("FVR_formId_orderIndex_idx").on(table.formId, table.orderIndex),
    index("FVR_providerName_idx").on(table.providerName),
    index("FVR_providerName_ruleType_idx").on(
      table.providerName,
      table.ruleType,
    ),
  ],
);

// ── Form Validation Rule Block (rule ↔ referenced block) ────────────

export const formValidationRuleBlock = mysqlTable(
  "FormValidationRuleBlock",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    ruleId: varchar("ruleId", { length: 128 })
      .notNull()
      .references(() => formValidationRule.id, { onDelete: "cascade" }),
    referencedBlockId: varchar("referencedBlockId", { length: 128 }).notNull(),
    orderIndex: int("orderIndex").notNull().default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("FVRB_ruleId_referencedBlockId_unique").on(
      table.ruleId,
      table.referencedBlockId,
    ),
    index("FVRB_ruleId_idx").on(table.ruleId),
    index("FVRB_referencedBlockId_idx").on(table.referencedBlockId),
  ],
);

// ── External Service Validation Result ──────────────────────────────

export const externalServiceValidationResult = mysqlTable(
  "ExternalServiceValidationResult",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    responseId: varchar("responseId", { length: 128 })
      .notNull()
      .references(() => formResponse.id, { onDelete: "cascade" }),
    ruleId: varchar("ruleId", { length: 128 })
      .notNull()
      .references(() => formValidationRule.id, { onDelete: "cascade" }),
    referencedBlockId: varchar("referencedBlockId", { length: 128 }).notNull(),
    service: varchar("service", { length: 64 }),
    status: validationStatusEnum.default("PENDING").notNull(),
    success: boolean("success"),
    attemptCount: int("attemptCount").default(0).notNull(),
    lastAttemptAt: timestamp("lastAttemptAt"),
    nextRetryAt: timestamp("nextRetryAt"),
    metadata: json("metadata"),
    errorCode: varchar("errorCode", { length: 255 }),
    errorMessage: text("errorMessage"),
    jobId: varchar("jobId", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("ESVR_responseId_idx").on(table.responseId),
    index("ESVR_ruleId_idx").on(table.ruleId),
    index("ESVR_status_idx").on(table.status),
    index("ESVR_nextRetryAt_idx").on(table.nextRetryAt),
    uniqueIndex("ESVR_responseId_ruleId_referencedBlockId_unique").on(
      table.responseId,
      table.ruleId,
      table.referencedBlockId,
    ),
  ],
);

// ── Validation Discord Guild ────────────────────────────────────────

export const validationDiscordGuild = mysqlTable(
  "ValidationDiscordGuild",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    iconUrl: varchar("iconUrl", { length: 512 }),
    ownerId: varchar("ownerId", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("ValidationDiscordGuild_ownerId_idx").on(table.ownerId)],
);

// ── Validation Discord Role ─────────────────────────────────────────

export const validationDiscordRole = mysqlTable(
  "ValidationDiscordRole",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    guildId: varchar("guildId", { length: 255 })
      .notNull()
      .references(() => validationDiscordGuild.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    color: int("color").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("ValidationDiscordRole_guildId_idx").on(table.guildId)],
);

// ── System Setting ──────────────────────────────────────────────────

export const systemSetting = mysqlTable("SystemSetting", {
  id: varchar("id", { length: 128 }).primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: json("value").notNull(),
  description: varchar("description", { length: 1024 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ── Relations ───────────────────────────────────────────────────────

export const discordUserRelations = relations(discordUser, ({ one, many }) => ({
  user: one(user, {
    fields: [discordUser.email],
    references: [user.email],
  }),
  guilds: many(discordGuild),
}));

export const discordGuildRelations = relations(discordGuild, ({ one }) => ({
  discordUser: one(discordUser, {
    fields: [discordGuild.discordUserId],
    references: [discordUser.discordUserId],
  }),
}));

export const formRelations = relations(form, ({ one, many }) => ({
  creator: one(user, {
    fields: [form.creatorId],
    references: [user.id],
  }),
  structures: many(formStructure),
  schedules: many(formSchedule),
  responses: many(formResponse),
  permissions: many(formPermission),
  snapshots: many(formSnapshot),
  validationRules: many(formValidationRule),
  shareLinks: many(formShareLink),
  invitations: many(formInvitation),
  integration: one(formIntegration, {
    fields: [form.id],
    references: [formIntegration.formId],
  }),
}));

export const formScheduleRelations = relations(formSchedule, ({ one }) => ({
  form: one(form, {
    fields: [formSchedule.formId],
    references: [form.id],
  }),
}));

export const apiTokenRelations = relations(apiToken, ({ one }) => ({
  user: one(user, {
    fields: [apiToken.userId],
    references: [user.id],
  }),
  shareLink: one(formShareLink, {
    fields: [apiToken.shareLinkId],
    references: [formShareLink.id],
  }),
}));

export const formPermissionRelations = relations(formPermission, ({ one }) => ({
  form: one(form, {
    fields: [formPermission.formId],
    references: [form.id],
  }),
  user: one(user, {
    fields: [formPermission.userId],
    references: [user.id],
  }),
}));

export const formShareLinkRelations = relations(
  formShareLink,
  ({ one, many }) => ({
    form: one(form, {
      fields: [formShareLink.formId],
      references: [form.id],
    }),
    creator: one(user, {
      fields: [formShareLink.createdBy],
      references: [user.id],
    }),
    apiTokens: many(apiToken),
  }),
);

export const formIntegrationRelations = relations(
  formIntegration,
  ({ one }) => ({
    form: one(form, {
      fields: [formIntegration.formId],
      references: [form.id],
    }),
    owner: one(user, {
      fields: [formIntegration.ownerUserId],
      references: [user.id],
    }),
    user: one(user, {
      fields: [formIntegration.userId],
      references: [user.id],
    }),
  }),
);

export const formInvitationRelations = relations(formInvitation, ({ one }) => ({
  form: one(form, {
    fields: [formInvitation.formId],
    references: [form.id],
  }),
  invitedByUser: one(user, {
    fields: [formInvitation.invitedBy],
    references: [user.id],
  }),
}));

export const formStructureRelations = relations(formStructure, ({ one }) => ({
  form: one(form, {
    fields: [formStructure.formId],
    references: [form.id],
  }),
  createdByUser: one(user, {
    fields: [formStructure.createdBy],
    references: [user.id],
  }),
}));

export const formResponseRelations = relations(
  formResponse,
  ({ one, many }) => ({
    form: one(form, {
      fields: [formResponse.formId],
      references: [form.id],
    }),
    session: one(formSession, {
      fields: [formResponse.sessionId],
      references: [formSession.id],
    }),
    fingerprintDetails: many(fingerprintDetail),
    validationResults: many(externalServiceValidationResult),
  }),
);

export const fingerprintDetailRelations = relations(
  fingerprintDetail,
  ({ one }) => ({
    response: one(formResponse, {
      fields: [fingerprintDetail.responseId],
      references: [formResponse.id],
    }),
  }),
);

export const userInviteRelations = relations(userInvite, ({ one }) => ({
  invitedByUser: one(user, {
    fields: [userInvite.invitedBy],
    references: [user.id],
  }),
}));

export const formSnapshotRelations = relations(formSnapshot, ({ one }) => ({
  form: one(form, {
    fields: [formSnapshot.formId],
    references: [form.id],
  }),
  publishedByUser: one(user, {
    fields: [formSnapshot.publishedBy],
    references: [user.id],
  }),
}));

export const googleOAuthTokenRelations = relations(
  googleOAuthToken,
  ({ one }) => ({
    user: one(user, {
      fields: [googleOAuthToken.userId],
      references: [user.id],
    }),
  }),
);

export const formSessionRelations = relations(formSession, ({ many }) => ({
  responses: many(formResponse),
}));

export const formValidationRuleRelations = relations(
  formValidationRule,
  ({ one, many }) => ({
    form: one(form, {
      fields: [formValidationRule.formId],
      references: [form.id],
    }),
    ruleBlocks: many(formValidationRuleBlock),
    results: many(externalServiceValidationResult),
  }),
);

export const formValidationRuleBlockRelations = relations(
  formValidationRuleBlock,
  ({ one }) => ({
    rule: one(formValidationRule, {
      fields: [formValidationRuleBlock.ruleId],
      references: [formValidationRule.id],
    }),
  }),
);

export const externalServiceValidationResultRelations = relations(
  externalServiceValidationResult,
  ({ one }) => ({
    response: one(formResponse, {
      fields: [externalServiceValidationResult.responseId],
      references: [formResponse.id],
    }),
    rule: one(formValidationRule, {
      fields: [externalServiceValidationResult.ruleId],
      references: [formValidationRule.id],
    }),
  }),
);

export const validationDiscordGuildRelations = relations(
  validationDiscordGuild,
  ({ many }) => ({
    roles: many(validationDiscordRole),
  }),
);

export const validationDiscordRoleRelations = relations(
  validationDiscordRole,
  ({ one }) => ({
    guild: one(validationDiscordGuild, {
      fields: [validationDiscordRole.guildId],
      references: [validationDiscordGuild.id],
    }),
  }),
);
