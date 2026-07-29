CREATE TABLE `ResponseLinkAnalysisRun` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`modelVersion` varchar(64) NOT NULL,
	`statsVersion` varchar(128),
	`status` varchar(32) NOT NULL,
	`populationSize` int NOT NULL DEFAULT 0,
	`metadataJson` json,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ResponseLinkAnalysisRun_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ResponsePairLink` (
	`id` varchar(255) NOT NULL,
	`runId` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`responseIdA` varchar(128) NOT NULL,
	`responseIdB` varchar(128) NOT NULL,
	`strength` varchar(16) NOT NULL,
	`deviceEvidence` float NOT NULL DEFAULT 0,
	`v4Support` boolean NOT NULL DEFAULT false,
	`v6Strong` boolean NOT NULL DEFAULT false,
	`stateSupport` boolean NOT NULL DEFAULT false,
	`breakdownJson` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ResponsePairLink_id` PRIMARY KEY(`id`),
	CONSTRAINT `RPL_run_pair_unique` UNIQUE(`runId`,`responseIdA`,`responseIdB`)
);
--> statement-breakpoint
CREATE TABLE `ResponseSuspicionGroup` (
	`id` varchar(255) NOT NULL,
	`runId` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`groupKey` varchar(512) NOT NULL,
	`technicalConfidence` varchar(16) NOT NULL,
	`responseCount` int NOT NULL DEFAULT 0,
	`strongLinkCount` int NOT NULL DEFAULT 0,
	`supportLinkCount` int NOT NULL DEFAULT 0,
	`summaryJson` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ResponseSuspicionGroup_id` PRIMARY KEY(`id`),
	CONSTRAINT `RSG_run_groupKey_unique` UNIQUE(`runId`,`groupKey`)
);
--> statement-breakpoint
CREATE TABLE `ResponseSuspicionGroupMember` (
	`id` varchar(255) NOT NULL,
	`runId` varchar(128) NOT NULL,
	`groupId` varchar(255) NOT NULL,
	`responseId` varchar(128) NOT NULL,
	`strongestStrength` varchar(16) NOT NULL,
	`strongestEvidence` float NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ResponseSuspicionGroupMember_id` PRIMARY KEY(`id`),
	CONSTRAINT `RSGM_group_response_unique` UNIQUE(`groupId`,`responseId`)
);
--> statement-breakpoint
ALTER TABLE `ResponseLinkAnalysisRun` ADD CONSTRAINT `ResponseLinkAnalysisRun_formId_Form_id_fk` FOREIGN KEY (`formId`) REFERENCES `Form`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResponsePairLink` ADD CONSTRAINT `ResponsePairLink_runId_ResponseLinkAnalysisRun_id_fk` FOREIGN KEY (`runId`) REFERENCES `ResponseLinkAnalysisRun`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResponsePairLink` ADD CONSTRAINT `ResponsePairLink_formId_Form_id_fk` FOREIGN KEY (`formId`) REFERENCES `Form`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResponsePairLink` ADD CONSTRAINT `ResponsePairLink_responseIdA_FormResponse_id_fk` FOREIGN KEY (`responseIdA`) REFERENCES `FormResponse`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResponsePairLink` ADD CONSTRAINT `ResponsePairLink_responseIdB_FormResponse_id_fk` FOREIGN KEY (`responseIdB`) REFERENCES `FormResponse`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResponseSuspicionGroup` ADD CONSTRAINT `ResponseSuspicionGroup_runId_ResponseLinkAnalysisRun_id_fk` FOREIGN KEY (`runId`) REFERENCES `ResponseLinkAnalysisRun`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResponseSuspicionGroup` ADD CONSTRAINT `ResponseSuspicionGroup_formId_Form_id_fk` FOREIGN KEY (`formId`) REFERENCES `Form`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResponseSuspicionGroupMember` ADD CONSTRAINT `ResponseSuspicionGroupMember_runId_ResponseLinkAnalysisRun_id_fk` FOREIGN KEY (`runId`) REFERENCES `ResponseLinkAnalysisRun`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResponseSuspicionGroupMember` ADD CONSTRAINT `RSGM_group_fk` FOREIGN KEY (`groupId`) REFERENCES `ResponseSuspicionGroup`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResponseSuspicionGroupMember` ADD CONSTRAINT `ResponseSuspicionGroupMember_responseId_FormResponse_id_fk` FOREIGN KEY (`responseId`) REFERENCES `FormResponse`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `RLAR_formId_status_completedAt_idx` ON `ResponseLinkAnalysisRun` (`formId`,`status`,`completedAt`);--> statement-breakpoint
CREATE INDEX `RLAR_formId_modelVersion_idx` ON `ResponseLinkAnalysisRun` (`formId`,`modelVersion`);--> statement-breakpoint
CREATE INDEX `RPL_formId_runId_strength_idx` ON `ResponsePairLink` (`formId`,`runId`,`strength`);--> statement-breakpoint
CREATE INDEX `RPL_runId_responseA_idx` ON `ResponsePairLink` (`runId`,`responseIdA`);--> statement-breakpoint
CREATE INDEX `RPL_runId_responseB_idx` ON `ResponsePairLink` (`runId`,`responseIdB`);--> statement-breakpoint
CREATE INDEX `RSG_formId_runId_confidence_idx` ON `ResponseSuspicionGroup` (`formId`,`runId`,`technicalConfidence`);--> statement-breakpoint
CREATE INDEX `RSGM_run_response_idx` ON `ResponseSuspicionGroupMember` (`runId`,`responseId`);
