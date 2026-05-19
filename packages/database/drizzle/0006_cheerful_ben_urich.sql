DELETE `FormIntegration` FROM `FormIntegration` LEFT JOIN `User` ON `User`.`id` = `FormIntegration`.`owner_user_id` WHERE `User`.`id` IS NULL;--> statement-breakpoint
UPDATE `FormIntegration` LEFT JOIN `User` ON `User`.`id` = `FormIntegration`.`user_id` SET `FormIntegration`.`user_id` = NULL WHERE `FormIntegration`.`user_id` IS NOT NULL AND `User`.`id` IS NULL;--> statement-breakpoint
DELETE `FormInvitation` FROM `FormInvitation` LEFT JOIN `User` ON `User`.`id` = `FormInvitation`.`invitedBy` WHERE `User`.`id` IS NULL;--> statement-breakpoint
DELETE `UserInvite` FROM `UserInvite` LEFT JOIN `User` ON `User`.`id` = `UserInvite`.`invitedBy` WHERE `User`.`id` IS NULL;--> statement-breakpoint
DELETE `ValidationDiscordRole` FROM `ValidationDiscordRole` LEFT JOIN `ValidationDiscordGuild` ON `ValidationDiscordGuild`.`id` = `ValidationDiscordRole`.`guildId` WHERE `ValidationDiscordGuild`.`id` IS NULL;--> statement-breakpoint
ALTER TABLE `FormIntegration` MODIFY COLUMN `owner_user_id` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `FormIntegration` MODIFY COLUMN `user_id` varchar(191);--> statement-breakpoint
ALTER TABLE `FormInvitation` MODIFY COLUMN `invitedBy` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `FormShareLink` MODIFY COLUMN `createdBy` varchar(255);--> statement-breakpoint
ALTER TABLE `FormSnapshot` MODIFY COLUMN `publishedBy` varchar(255);--> statement-breakpoint
ALTER TABLE `FormStructure` MODIFY COLUMN `createdBy` varchar(255);--> statement-breakpoint
ALTER TABLE `UserInvite` MODIFY COLUMN `invitedBy` varchar(191) NOT NULL;--> statement-breakpoint
UPDATE `FormShareLink` LEFT JOIN `User` ON `User`.`id` = `FormShareLink`.`createdBy` SET `FormShareLink`.`createdBy` = NULL WHERE `FormShareLink`.`createdBy` IS NOT NULL AND `User`.`id` IS NULL;--> statement-breakpoint
UPDATE `FormSnapshot` LEFT JOIN `User` ON `User`.`id` = `FormSnapshot`.`publishedBy` SET `FormSnapshot`.`publishedBy` = NULL WHERE `FormSnapshot`.`publishedBy` IS NOT NULL AND `User`.`id` IS NULL;--> statement-breakpoint
UPDATE `FormStructure` LEFT JOIN `User` ON `User`.`id` = `FormStructure`.`createdBy` SET `FormStructure`.`createdBy` = NULL WHERE `FormStructure`.`createdBy` IS NOT NULL AND `User`.`id` IS NULL;--> statement-breakpoint
ALTER TABLE `FormShareLink` MODIFY COLUMN `createdBy` varchar(191);--> statement-breakpoint
ALTER TABLE `FormSnapshot` MODIFY COLUMN `publishedBy` varchar(191);--> statement-breakpoint
ALTER TABLE `FormStructure` MODIFY COLUMN `createdBy` varchar(191);--> statement-breakpoint
CREATE INDEX `FormSnapshot_publishedBy_idx` ON `FormSnapshot` (`publishedBy`);--> statement-breakpoint
CREATE INDEX `FormStructure_createdBy_idx` ON `FormStructure` (`createdBy`);--> statement-breakpoint
CREATE INDEX `UserInvite_invitedBy_idx` ON `UserInvite` (`invitedBy`);--> statement-breakpoint
ALTER TABLE `FormIntegration` ADD CONSTRAINT `FormIntegration_owner_user_id_User_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormIntegration` ADD CONSTRAINT `FormIntegration_user_id_User_id_fk` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormInvitation` ADD CONSTRAINT `FormInvitation_invitedBy_User_id_fk` FOREIGN KEY (`invitedBy`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormShareLink` ADD CONSTRAINT `FormShareLink_createdBy_User_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormSnapshot` ADD CONSTRAINT `FormSnapshot_publishedBy_User_id_fk` FOREIGN KEY (`publishedBy`) REFERENCES `User`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormStructure` ADD CONSTRAINT `FormStructure_createdBy_User_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `UserInvite` ADD CONSTRAINT `UserInvite_invitedBy_User_id_fk` FOREIGN KEY (`invitedBy`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ValidationDiscordRole` ADD CONSTRAINT `ValidationDiscordRole_guildId_ValidationDiscordGuild_id_fk` FOREIGN KEY (`guildId`) REFERENCES `ValidationDiscordGuild`(`id`) ON DELETE cascade ON UPDATE no action;
