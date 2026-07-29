CREATE TABLE `FingerprintCollectionAttempt` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`challengeTokenHash` varchar(64) NOT NULL,
	`collectionTokenHash` varchar(64),
	`observedIpHash` varchar(255) NOT NULL,
	`userAgentHash` varchar(64) NOT NULL,
	`collectorVersion` varchar(64) NOT NULL,
	`exchangeVersion` int NOT NULL,
	`exchangeNonce` varchar(64) NOT NULL,
	`fieldMapJson` json NOT NULL,
	`componentOrderJson` json NOT NULL,
	`challengeExpiresAt` timestamp NOT NULL,
	`collectionExpiresAt` timestamp,
	`finalizedAt` timestamp,
	`consumedAt` timestamp,
	`consumedResponseId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `FingerprintCollectionAttempt_id` PRIMARY KEY(`id`),
	CONSTRAINT `FingerprintCollectionAttempt_challengeTokenHash_unique` UNIQUE(`challengeTokenHash`),
	CONSTRAINT `FingerprintCollectionAttempt_collectionTokenHash_unique` UNIQUE(`collectionTokenHash`)
);
--> statement-breakpoint
CREATE TABLE `FingerprintCollectionDetail` (
	`id` varchar(128) NOT NULL,
	`attemptId` varchar(128) NOT NULL,
	`fingerprintType` varchar(50) NOT NULL,
	`componentName` varchar(255) NOT NULL,
	`componentValueHash` varchar(255) NOT NULL,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `FingerprintCollectionDetail_id` PRIMARY KEY(`id`),
	CONSTRAINT `FCD_attempt_type_component_key` UNIQUE(`attemptId`,`fingerprintType`,`componentName`)
);
--> statement-breakpoint
ALTER TABLE `FingerprintCollectionAttempt` ADD CONSTRAINT `FCA_formId_fk` FOREIGN KEY (`formId`) REFERENCES `Form`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `FingerprintCollectionAttempt` ADD CONSTRAINT `FCA_consumedResponseId_fk` FOREIGN KEY (`consumedResponseId`) REFERENCES `FormResponse`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `FingerprintCollectionDetail` ADD CONSTRAINT `FCD_attemptId_fk` FOREIGN KEY (`attemptId`) REFERENCES `FingerprintCollectionAttempt`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `FingerprintCollectionAttempt_formId_idx` ON `FingerprintCollectionAttempt` (`formId`);
--> statement-breakpoint
CREATE INDEX `FingerprintCollectionAttempt_challengeTokenHash_idx` ON `FingerprintCollectionAttempt` (`challengeTokenHash`);
--> statement-breakpoint
CREATE INDEX `FingerprintCollectionAttempt_collectionTokenHash_idx` ON `FingerprintCollectionAttempt` (`collectionTokenHash`);
--> statement-breakpoint
CREATE INDEX `FingerprintCollectionAttempt_expiresAt_idx` ON `FingerprintCollectionAttempt` (`challengeExpiresAt`,`collectionExpiresAt`);
--> statement-breakpoint
CREATE INDEX `FingerprintCollectionAttempt_consumedAt_idx` ON `FingerprintCollectionAttempt` (`consumedAt`);
--> statement-breakpoint
CREATE INDEX `FingerprintCollectionDetail_attemptId_idx` ON `FingerprintCollectionDetail` (`attemptId`);
--> statement-breakpoint
CREATE INDEX `FingerprintCollectionDetail_fingerprintType_idx` ON `FingerprintCollectionDetail` (`fingerprintType`);
