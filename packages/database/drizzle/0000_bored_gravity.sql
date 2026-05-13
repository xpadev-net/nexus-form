CREATE TABLE `ApiToken` (
	`id` varchar(128) NOT NULL,
	`userId` varchar(255),
	`name` varchar(255) NOT NULL,
	`tokenHash` varchar(255) NOT NULL,
	`lookupHash` varchar(64),
	`scopes` json NOT NULL,
	`formIds` json,
	`api_token_type` enum('USER','FORM','SHARE_LINK') NOT NULL DEFAULT 'USER',
	`isActive` boolean NOT NULL DEFAULT true,
	`expiresAt` timestamp,
	`lastUsedAt` timestamp,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`shareLinkId` varchar(128),
	CONSTRAINT `ApiToken_id` PRIMARY KEY(`id`),
	CONSTRAINT `ApiToken_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `DataSubjectRequest` (
	`id` varchar(128) NOT NULL,
	`email` varchar(255) NOT NULL,
	`data_subject_request_type` enum('EXPORT','DELETE') NOT NULL,
	`data_subject_request_status` enum('PENDING','PROCESSING','COMPLETED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `DataSubjectRequest_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `DiscordGuild` (
	`id` varchar(128) NOT NULL,
	`guildId` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`iconUrl` varchar(512),
	`discordUserId` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `DiscordGuild_id` PRIMARY KEY(`id`),
	CONSTRAINT `DiscordGuild_discordUserId_guildId_key` UNIQUE(`discordUserId`,`guildId`)
);
--> statement-breakpoint
CREATE TABLE `DiscordUser` (
	`id` varchar(128) NOT NULL,
	`email` varchar(255) NOT NULL,
	`discordUserId` varchar(255) NOT NULL,
	`avatarUrl` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `DiscordUser_id` PRIMARY KEY(`id`),
	CONSTRAINT `DiscordUser_email_unique` UNIQUE(`email`),
	CONSTRAINT `DiscordUser_discordUserId_unique` UNIQUE(`discordUserId`)
);
--> statement-breakpoint
CREATE TABLE `ExternalServiceValidationResult` (
	`id` varchar(128) NOT NULL,
	`responseId` varchar(128) NOT NULL,
	`ruleId` varchar(128) NOT NULL,
	`referencedBlockId` varchar(128) NOT NULL,
	`service` varchar(64),
	`validation_status` enum('PENDING','PROCESSING','COMPLETED','FAILED','MISSING') NOT NULL DEFAULT 'PENDING',
	`success` boolean,
	`attemptCount` int NOT NULL DEFAULT 0,
	`lastAttemptAt` timestamp,
	`nextRetryAt` timestamp,
	`metadata` json,
	`errorCode` varchar(255),
	`errorMessage` varchar(1024),
	`jobId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ExternalServiceValidationResult_id` PRIMARY KEY(`id`),
	CONSTRAINT `ESVR_responseId_ruleId_referencedBlockId_unique` UNIQUE(`responseId`,`ruleId`,`referencedBlockId`)
);
--> statement-breakpoint
CREATE TABLE `FingerprintDetail` (
	`id` varchar(128) NOT NULL,
	`responseId` varchar(128) NOT NULL,
	`fingerprintType` varchar(50) NOT NULL,
	`componentName` varchar(255) NOT NULL,
	`componentValue` text NOT NULL,
	`componentValueHash` varchar(255) NOT NULL,
	`confidence` float,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	CONSTRAINT `FingerprintDetail_id` PRIMARY KEY(`id`),
	CONSTRAINT `FingerprintDetail_responseId_fingerprintType_componentName_key` UNIQUE(`responseId`,`fingerprintType`,`componentName`)
);
--> statement-breakpoint
CREATE TABLE `Form` (
	`id` varchar(128) NOT NULL,
	`publicId` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`creatorId` varchar(255) NOT NULL,
	`form_status` enum('DRAFT','PUBLISHED','UNPUBLISHED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
	`publishedAt` timestamp,
	`unpublishedAt` timestamp,
	`allowEditResponses` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`version` int NOT NULL DEFAULT 1,
	`plateContent` longtext,
	`plateContentVersion` int NOT NULL DEFAULT 0,
	`baseSnapshotVersion` int,
	CONSTRAINT `Form_id` PRIMARY KEY(`id`),
	CONSTRAINT `Form_publicId_unique` UNIQUE(`publicId`)
);
--> statement-breakpoint
CREATE TABLE `FormIntegration` (
	`id` varchar(128) NOT NULL,
	`form_id` varchar(128) NOT NULL,
	`config_json` text NOT NULL,
	`owner_user_id` varchar(255) NOT NULL,
	`user_id` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `FormIntegration_id` PRIMARY KEY(`id`),
	CONSTRAINT `FormIntegration_formId_key` UNIQUE(`form_id`)
);
--> statement-breakpoint
CREATE TABLE `FormInvitation` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`email` varchar(255) NOT NULL,
	`form_permission_role` enum('OWNER','EDITOR','VIEWER') NOT NULL,
	`token` varchar(255) NOT NULL,
	`invite_status` enum('PENDING','ACCEPTED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`message` text,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`invitedBy` varchar(255) NOT NULL,
	CONSTRAINT `FormInvitation_id` PRIMARY KEY(`id`),
	CONSTRAINT `FormInvitation_token_unique` UNIQUE(`token`),
	CONSTRAINT `FormInvitation_formId_email_key` UNIQUE(`formId`,`email`)
);
--> statement-breakpoint
CREATE TABLE `FormPermission` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`userId` varchar(255) NOT NULL,
	`form_permission_role` enum('OWNER','EDITOR','VIEWER') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `FormPermission_id` PRIMARY KEY(`id`),
	CONSTRAINT `FormPermission_formId_userId_key` UNIQUE(`formId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `FormResponse` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`responseDataJson` text NOT NULL,
	`submittedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp,
	`respondentUuid` varchar(255) NOT NULL,
	`userAgent` varchar(512),
	`sessionId` varchar(128),
	`countryCode` varchar(10),
	CONSTRAINT `FormResponse_id` PRIMARY KEY(`id`),
	CONSTRAINT `FormResponse_respondentUuid_unique` UNIQUE(`respondentUuid`)
);
--> statement-breakpoint
CREATE TABLE `FormSchedule` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`triggerAt` timestamp NOT NULL,
	`form_schedule_action` enum('PUBLISH','UNPUBLISH','SWITCH_SNAPSHOT') NOT NULL,
	`snapshotVersion` int,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `FormSchedule_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `FormSession` (
	`id` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`ipHash` varchar(255),
	`userAgent` text,
	`notes` text,
	CONSTRAINT `FormSession_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `FormShareLink` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`token` varchar(255) NOT NULL,
	`form_share_role` enum('EDITOR','VIEWER') NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`createdBy` varchar(255) NOT NULL,
	CONSTRAINT `FormShareLink_id` PRIMARY KEY(`id`),
	CONSTRAINT `FormShareLink_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `FormSnapshot` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`version` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`publishedBy` varchar(255) NOT NULL,
	`publishedAt` timestamp NOT NULL DEFAULT (now()),
	`changeLog` text,
	`title` varchar(255) NOT NULL,
	`description` text,
	`parentVersion` int,
	`plateContent` longtext NOT NULL,
	`validationRulesJson` text NOT NULL,
	CONSTRAINT `FormSnapshot_id` PRIMARY KEY(`id`),
	CONSTRAINT `FormSnapshot_formId_version_key` UNIQUE(`formId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `FormStructure` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`structureJson` text NOT NULL,
	`version` int NOT NULL,
	`createdBy` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`isActive` boolean NOT NULL DEFAULT true,
	`changeLog` text,
	`parentVersion` int,
	CONSTRAINT `FormStructure_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `FormValidationRule` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`name` varchar(200) NOT NULL,
	`providerName` varchar(64) NOT NULL,
	`ruleType` varchar(64) NOT NULL,
	`configJson` json NOT NULL,
	`orderIndex` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `FormValidationRule_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `FormValidationRuleBlock` (
	`id` varchar(128) NOT NULL,
	`ruleId` varchar(128) NOT NULL,
	`referencedBlockId` varchar(128) NOT NULL,
	`orderIndex` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `FormValidationRuleBlock_id` PRIMARY KEY(`id`),
	CONSTRAINT `FVRB_ruleId_referencedBlockId_unique` UNIQUE(`ruleId`,`referencedBlockId`)
);
--> statement-breakpoint
CREATE TABLE `GoogleOAuthToken` (
	`id` varchar(128) NOT NULL,
	`userId` varchar(255) NOT NULL,
	`provider` varchar(50) NOT NULL DEFAULT 'google',
	`accessTokenEnc` text NOT NULL,
	`refreshTokenEnc` text NOT NULL,
	`expiryDate` timestamp NOT NULL,
	`scopes` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `GoogleOAuthToken_id` PRIMARY KEY(`id`),
	CONSTRAINT `GoogleOAuthToken_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `SystemSetting` (
	`id` varchar(128) NOT NULL,
	`key` varchar(255) NOT NULL,
	`value` json NOT NULL,
	`description` varchar(1024),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `SystemSetting_id` PRIMARY KEY(`id`),
	CONSTRAINT `SystemSetting_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `TelemetryToken` (
	`id` varchar(128) NOT NULL,
	`token` varchar(255) NOT NULL,
	`ip` varchar(255) NOT NULL,
	`telemetry_version` enum('V4','V6') NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	CONSTRAINT `TelemetryToken_id` PRIMARY KEY(`id`),
	CONSTRAINT `TelemetryToken_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `UserInvite` (
	`id` varchar(128) NOT NULL,
	`email` varchar(255) NOT NULL,
	`token` varchar(255) NOT NULL,
	`invite_status` enum('PENDING','ACCEPTED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`message` text,
	`invitedBy` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	CONSTRAINT `UserInvite_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserInvite_email_unique` UNIQUE(`email`),
	CONSTRAINT `UserInvite_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `ValidationDiscordGuild` (
	`id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`iconUrl` varchar(512),
	`ownerId` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ValidationDiscordGuild_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ValidationDiscordRole` (
	`id` varchar(255) NOT NULL,
	`guildId` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`color` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ValidationDiscordRole_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `Account` (
	`id` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`providerId` varchar(191) NOT NULL,
	`accountId` varchar(191) NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`accessTokenExpiresAt` timestamp,
	`refreshTokenExpiresAt` timestamp,
	`idToken` text,
	`scope` varchar(191),
	`password` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `Account_id` PRIMARY KEY(`id`),
	CONSTRAINT `Account_providerId_accountId_key` UNIQUE(`providerId`,`accountId`)
);
--> statement-breakpoint
CREATE TABLE `Session` (
	`id` varchar(191) NOT NULL,
	`token` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`ipAddress` varchar(191),
	`userAgent` text,
	CONSTRAINT `Session_id` PRIMARY KEY(`id`),
	CONSTRAINT `Session_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `User` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191),
	`email` varchar(191) NOT NULL,
	`emailVerified` boolean NOT NULL DEFAULT false,
	`image` varchar(191),
	`role` varchar(50) NOT NULL DEFAULT 'user',
	`isSuspended` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `User_id` PRIMARY KEY(`id`),
	CONSTRAINT `User_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `VerificationToken` (
	`id` varchar(191) NOT NULL,
	`identifier` varchar(191) NOT NULL,
	`value` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `VerificationToken_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `Account` ADD CONSTRAINT `Account_userId_User_id_fk` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_User_id_fk` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ApiToken_userId_idx` ON `ApiToken` (`userId`);--> statement-breakpoint
CREATE INDEX `ApiToken_isActive_idx` ON `ApiToken` (`isActive`);--> statement-breakpoint
CREATE INDEX `ApiToken_type_idx` ON `ApiToken` (`api_token_type`);--> statement-breakpoint
CREATE INDEX `ApiToken_tokenHash_idx` ON `ApiToken` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `ApiToken_lookupHash_idx` ON `ApiToken` (`lookupHash`);--> statement-breakpoint
CREATE INDEX `ApiToken_shareLinkId_idx` ON `ApiToken` (`shareLinkId`);--> statement-breakpoint
CREATE INDEX `DataSubjectRequest_email_idx` ON `DataSubjectRequest` (`email`);--> statement-breakpoint
CREATE INDEX `DataSubjectRequest_status_idx` ON `DataSubjectRequest` (`data_subject_request_status`);--> statement-breakpoint
CREATE INDEX `DataSubjectRequest_requestedAt_idx` ON `DataSubjectRequest` (`requestedAt`);--> statement-breakpoint
CREATE INDEX `DataSubjectRequest_email_status_idx` ON `DataSubjectRequest` (`email`,`data_subject_request_status`);--> statement-breakpoint
CREATE INDEX `DataSubjectRequest_status_requestedAt_idx` ON `DataSubjectRequest` (`data_subject_request_status`,`requestedAt`);--> statement-breakpoint
CREATE INDEX `DiscordGuild_discordUserId_idx` ON `DiscordGuild` (`discordUserId`);--> statement-breakpoint
CREATE INDEX `DiscordGuild_guildId_idx` ON `DiscordGuild` (`guildId`);--> statement-breakpoint
CREATE INDEX `ESVR_responseId_idx` ON `ExternalServiceValidationResult` (`responseId`);--> statement-breakpoint
CREATE INDEX `ESVR_ruleId_idx` ON `ExternalServiceValidationResult` (`ruleId`);--> statement-breakpoint
CREATE INDEX `ESVR_status_idx` ON `ExternalServiceValidationResult` (`validation_status`);--> statement-breakpoint
CREATE INDEX `ESVR_nextRetryAt_idx` ON `ExternalServiceValidationResult` (`nextRetryAt`);--> statement-breakpoint
CREATE INDEX `FingerprintDetail_responseId_idx` ON `FingerprintDetail` (`responseId`);--> statement-breakpoint
CREATE INDEX `FingerprintDetail_fingerprintType_idx` ON `FingerprintDetail` (`fingerprintType`);--> statement-breakpoint
CREATE INDEX `FingerprintDetail_componentName_idx` ON `FingerprintDetail` (`componentName`);--> statement-breakpoint
CREATE INDEX `FingerprintDetail_responseId_fingerprintType_idx` ON `FingerprintDetail` (`responseId`,`fingerprintType`);--> statement-breakpoint
CREATE INDEX `FingerprintDetail_componentName_confidence_idx` ON `FingerprintDetail` (`componentName`,`confidence`);--> statement-breakpoint
CREATE INDEX `FingerprintDetail_expiresAt_idx` ON `FingerprintDetail` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `Form_creatorId_idx` ON `Form` (`creatorId`);--> statement-breakpoint
CREATE INDEX `Form_status_idx` ON `Form` (`form_status`);--> statement-breakpoint
CREATE INDEX `Form_title_idx` ON `Form` (`title`);--> statement-breakpoint
CREATE INDEX `Form_creatorId_status_idx` ON `Form` (`creatorId`,`form_status`);--> statement-breakpoint
CREATE INDEX `Form_updatedAt_idx` ON `Form` (`updatedAt`);--> statement-breakpoint
CREATE INDEX `Form_publicId_idx` ON `Form` (`publicId`);--> statement-breakpoint
CREATE INDEX `FormIntegration_formId_idx` ON `FormIntegration` (`form_id`);--> statement-breakpoint
CREATE INDEX `FormInvitation_formId_idx` ON `FormInvitation` (`formId`);--> statement-breakpoint
CREATE INDEX `FormInvitation_email_idx` ON `FormInvitation` (`email`);--> statement-breakpoint
CREATE INDEX `FormInvitation_token_idx` ON `FormInvitation` (`token`);--> statement-breakpoint
CREATE INDEX `FormInvitation_status_idx` ON `FormInvitation` (`invite_status`);--> statement-breakpoint
CREATE INDEX `FormInvitation_expiresAt_idx` ON `FormInvitation` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `FormInvitation_invitedBy_idx` ON `FormInvitation` (`invitedBy`);--> statement-breakpoint
CREATE INDEX `FormPermission_userId_idx` ON `FormPermission` (`userId`);--> statement-breakpoint
CREATE INDEX `FormPermission_formId_idx` ON `FormPermission` (`formId`);--> statement-breakpoint
CREATE INDEX `FormResponse_formId_idx` ON `FormResponse` (`formId`);--> statement-breakpoint
CREATE INDEX `FormResponse_submittedAt_idx` ON `FormResponse` (`submittedAt`);--> statement-breakpoint
CREATE INDEX `FormResponse_updatedAt_idx` ON `FormResponse` (`updatedAt`);--> statement-breakpoint
CREATE INDEX `FormResponse_formId_submittedAt_idx` ON `FormResponse` (`formId`,`submittedAt`);--> statement-breakpoint
CREATE INDEX `FormResponse_formId_updatedAt_idx` ON `FormResponse` (`formId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `FormResponse_sessionId_idx` ON `FormResponse` (`sessionId`);--> statement-breakpoint
CREATE INDEX `FormSchedule_formId_idx` ON `FormSchedule` (`formId`);--> statement-breakpoint
CREATE INDEX `FormSchedule_triggerAt_idx` ON `FormSchedule` (`triggerAt`);--> statement-breakpoint
CREATE INDEX `FormSchedule_action_idx` ON `FormSchedule` (`form_schedule_action`);--> statement-breakpoint
CREATE INDEX `FormSchedule_processedAt_idx` ON `FormSchedule` (`processedAt`);--> statement-breakpoint
CREATE INDEX `FormSchedule_formId_processedAt_idx` ON `FormSchedule` (`formId`,`processedAt`);--> statement-breakpoint
CREATE INDEX `FormSession_createdAt_idx` ON `FormSession` (`createdAt`);--> statement-breakpoint
CREATE INDEX `FormSession_lastSeenAt_idx` ON `FormSession` (`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `FormSession_ipHash_idx` ON `FormSession` (`ipHash`);--> statement-breakpoint
CREATE INDEX `FormShareLink_formId_idx` ON `FormShareLink` (`formId`);--> statement-breakpoint
CREATE INDEX `FormShareLink_token_idx` ON `FormShareLink` (`token`);--> statement-breakpoint
CREATE INDEX `FormShareLink_isActive_idx` ON `FormShareLink` (`isActive`);--> statement-breakpoint
CREATE INDEX `FormShareLink_expiresAt_idx` ON `FormShareLink` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `FormShareLink_createdBy_idx` ON `FormShareLink` (`createdBy`);--> statement-breakpoint
CREATE INDEX `FormSnapshot_formId_idx` ON `FormSnapshot` (`formId`);--> statement-breakpoint
CREATE INDEX `FormSnapshot_formId_isActive_idx` ON `FormSnapshot` (`formId`,`isActive`);--> statement-breakpoint
CREATE INDEX `FormSnapshot_publishedAt_idx` ON `FormSnapshot` (`publishedAt`);--> statement-breakpoint
CREATE INDEX `FormStructure_formId_version_idx` ON `FormStructure` (`formId`,`version`);--> statement-breakpoint
CREATE INDEX `FormStructure_isActive_idx` ON `FormStructure` (`isActive`);--> statement-breakpoint
CREATE INDEX `FormStructure_formId_isActive_version_idx` ON `FormStructure` (`formId`,`isActive`,`version`);--> statement-breakpoint
CREATE INDEX `FormStructure_formId_isActive_idx` ON `FormStructure` (`formId`,`isActive`);--> statement-breakpoint
CREATE INDEX `FVR_formId_idx` ON `FormValidationRule` (`formId`);--> statement-breakpoint
CREATE INDEX `FVR_formId_orderIndex_idx` ON `FormValidationRule` (`formId`,`orderIndex`);--> statement-breakpoint
CREATE INDEX `FVR_providerName_idx` ON `FormValidationRule` (`providerName`);--> statement-breakpoint
CREATE INDEX `FVR_providerName_ruleType_idx` ON `FormValidationRule` (`providerName`,`ruleType`);--> statement-breakpoint
CREATE INDEX `FVRB_ruleId_idx` ON `FormValidationRuleBlock` (`ruleId`);--> statement-breakpoint
CREATE INDEX `FVRB_referencedBlockId_idx` ON `FormValidationRuleBlock` (`referencedBlockId`);--> statement-breakpoint
CREATE INDEX `GoogleOAuthToken_userId_idx` ON `GoogleOAuthToken` (`userId`);--> statement-breakpoint
CREATE INDEX `TelemetryToken_token_idx` ON `TelemetryToken` (`token`);--> statement-breakpoint
CREATE INDEX `TelemetryToken_ip_idx` ON `TelemetryToken` (`ip`);--> statement-breakpoint
CREATE INDEX `TelemetryToken_version_idx` ON `TelemetryToken` (`telemetry_version`);--> statement-breakpoint
CREATE INDEX `TelemetryToken_usedAt_idx` ON `TelemetryToken` (`usedAt`);--> statement-breakpoint
CREATE INDEX `TelemetryToken_expiresAt_idx` ON `TelemetryToken` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `TelemetryToken_ip_version_idx` ON `TelemetryToken` (`ip`,`telemetry_version`);--> statement-breakpoint
CREATE INDEX `UserInvite_email_idx` ON `UserInvite` (`email`);--> statement-breakpoint
CREATE INDEX `UserInvite_token_idx` ON `UserInvite` (`token`);--> statement-breakpoint
CREATE INDEX `UserInvite_status_idx` ON `UserInvite` (`invite_status`);--> statement-breakpoint
CREATE INDEX `UserInvite_expiresAt_idx` ON `UserInvite` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `ValidationDiscordGuild_ownerId_idx` ON `ValidationDiscordGuild` (`ownerId`);--> statement-breakpoint
CREATE INDEX `ValidationDiscordRole_guildId_idx` ON `ValidationDiscordRole` (`guildId`);--> statement-breakpoint
CREATE INDEX `Account_userId_idx` ON `Account` (`userId`);--> statement-breakpoint
CREATE INDEX `Session_userId_idx` ON `Session` (`userId`);