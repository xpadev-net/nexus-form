CREATE TABLE `ResponseLinkAnalysisLock` (
	`formId` varchar(128) NOT NULL,
	`jobId` varchar(255) NOT NULL,
	`lockedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ResponseLinkAnalysisLock_formId` PRIMARY KEY(`formId`)
);
--> statement-breakpoint
ALTER TABLE `ResponseLinkAnalysisLock` ADD CONSTRAINT `ResponseLinkAnalysisLock_formId_Form_id_fk` FOREIGN KEY (`formId`) REFERENCES `Form`(`id`) ON DELETE cascade ON UPDATE no action;