CREATE TABLE `FingerprintCollectionAttempt` (
	`id` varchar(128) NOT NULL,
	`formId` varchar(128) NOT NULL,
	`challengeTokenHash` varchar(64) NOT NULL,
	`collectionTokenHash` varchar(64),
	`observedIpHash` varchar(64) NOT NULL,
	`userAgentHash` varchar(64) NOT NULL,
	`collectorVersion` varchar(64) NOT NULL,
	`exchangeVersion` int NOT NULL,
	`exchangeNonce` varchar(64) NOT NULL,
	`serverContextJson` json NOT NULL,
	`observationDigestJson` json NOT NULL,
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
ALTER TABLE `FingerprintCollectionAttempt` ADD CONSTRAINT `FCA_formId_fk` FOREIGN KEY (`formId`) REFERENCES `Form`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `FingerprintCollectionAttempt` ADD CONSTRAINT `FCA_consumedResponseId_fk` FOREIGN KEY (`consumedResponseId`) REFERENCES `FormResponse`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `FingerprintCollectionAttempt_expiresAt_idx` ON `FingerprintCollectionAttempt` (`challengeExpiresAt`,`collectionExpiresAt`);
--> statement-breakpoint
CREATE INDEX `FingerprintCollectionAttempt_consumedAt_idx` ON `FingerprintCollectionAttempt` (`consumedAt`);
