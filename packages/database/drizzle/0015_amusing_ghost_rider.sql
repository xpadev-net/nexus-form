-- Rolling deploy: apply this additive migration before starting new API replicas.
-- Old replicas ignore this table; submissions accepted by them during the overlap
-- retain legacy best-effort side effects until all old replicas are drained.
CREATE TABLE `FormSubmitOutbox` (
	`id` varchar(255) NOT NULL,
	`responseId` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`effectType` varchar(32) NOT NULL,
	`snapshotVersion` int,
	`integrationId` varchar(128),
	`claimToken` varchar(128),
	`claimExpiresAt` timestamp,
	`enqueuedAt` timestamp,
	`attemptCount` int NOT NULL DEFAULT 0,
	`lastAttemptAt` timestamp,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `FormSubmitOutbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `FormSubmitOutbox_responseId_effectType_key` UNIQUE(`responseId`,`effectType`)
);
--> statement-breakpoint
ALTER TABLE `FormSubmitOutbox` ADD CONSTRAINT `FormSubmitOutbox_responseId_FormResponse_id_fk` FOREIGN KEY (`responseId`) REFERENCES `FormResponse`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormSubmitOutbox` ADD CONSTRAINT `FormSubmitOutbox_formId_Form_id_fk` FOREIGN KEY (`formId`) REFERENCES `Form`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `FormSubmitOutbox_pending_claim_idx` ON `FormSubmitOutbox` (`enqueuedAt`,`claimExpiresAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `FormSubmitOutbox_formId_idx` ON `FormSubmitOutbox` (`formId`);
