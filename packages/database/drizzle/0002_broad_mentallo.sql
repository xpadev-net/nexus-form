ALTER TABLE `ApiToken` DROP FOREIGN KEY `ApiToken_userId_User_id_fk`;--> statement-breakpoint
ALTER TABLE `Form` DROP FOREIGN KEY `Form_creatorId_User_id_fk`;--> statement-breakpoint
ALTER TABLE `FormPermission` DROP FOREIGN KEY `FormPermission_userId_User_id_fk`;--> statement-breakpoint
ALTER TABLE `GoogleOAuthToken` DROP FOREIGN KEY `GoogleOAuthToken_userId_User_id_fk`;--> statement-breakpoint
ALTER TABLE `ApiToken` MODIFY COLUMN `userId` varchar(191);--> statement-breakpoint
ALTER TABLE `Form` MODIFY COLUMN `creatorId` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `FormPermission` MODIFY COLUMN `userId` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `GoogleOAuthToken` MODIFY COLUMN `userId` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `ApiToken` ADD CONSTRAINT `ApiToken_userId_User_id_fk` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `Form` ADD CONSTRAINT `Form_creatorId_User_id_fk` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormPermission` ADD CONSTRAINT `FormPermission_userId_User_id_fk` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `GoogleOAuthToken` ADD CONSTRAINT `GoogleOAuthToken_userId_User_id_fk` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;
