ALTER TABLE `ExternalServiceValidationResult` ADD `claimToken` varchar(128);--> statement-breakpoint
ALTER TABLE `ExternalServiceValidationResult` ADD `claimExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `ExternalServiceValidationResult` ADD `enqueueAttemptCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ExternalServiceValidationResult` ADD `nextEligibleAt` timestamp;--> statement-breakpoint
ALTER TABLE `ExternalServiceValidationResult` ADD `validation_enqueue_mode` enum('LEGACY','STABLE') DEFAULT 'LEGACY' NOT NULL;--> statement-breakpoint
CREATE INDEX `ESVR_enqueue_eligibility_lease_idx` ON `ExternalServiceValidationResult` (`validation_status`,`nextEligibleAt`,`claimExpiresAt`,`createdAt`);