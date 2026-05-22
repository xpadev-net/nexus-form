ALTER TABLE `ApiToken` MODIFY COLUMN `userId` varchar(191);--> statement-breakpoint
ALTER TABLE `Form` MODIFY COLUMN `creatorId` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `FormPermission` MODIFY COLUMN `userId` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `GoogleOAuthToken` MODIFY COLUMN `userId` varchar(191) NOT NULL;
