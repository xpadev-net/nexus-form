DELETE `FormIntegration` FROM `FormIntegration` LEFT JOIN `User` ON `User`.`id` = `FormIntegration`.`owner_user_id` WHERE `User`.`id` IS NULL;--> statement-breakpoint
UPDATE `FormIntegration` LEFT JOIN `User` ON `User`.`id` = `FormIntegration`.`user_id` SET `FormIntegration`.`user_id` = NULL WHERE `FormIntegration`.`user_id` IS NOT NULL AND `User`.`id` IS NULL;--> statement-breakpoint
DELETE `FormInvitation` FROM `FormInvitation` LEFT JOIN `User` ON `User`.`id` = `FormInvitation`.`invitedBy` WHERE `User`.`id` IS NULL;--> statement-breakpoint
DELETE `FormShareLink` FROM `FormShareLink` LEFT JOIN `User` ON `User`.`id` = `FormShareLink`.`createdBy` WHERE `User`.`id` IS NULL;--> statement-breakpoint
DELETE `FormSnapshot` FROM `FormSnapshot` LEFT JOIN `User` ON `User`.`id` = `FormSnapshot`.`publishedBy` WHERE `User`.`id` IS NULL;--> statement-breakpoint
DELETE `FormStructure` FROM `FormStructure` LEFT JOIN `User` ON `User`.`id` = `FormStructure`.`createdBy` WHERE `User`.`id` IS NULL;--> statement-breakpoint
DELETE `UserInvite` FROM `UserInvite` LEFT JOIN `User` ON `User`.`id` = `UserInvite`.`invitedBy` WHERE `User`.`id` IS NULL;--> statement-breakpoint
DELETE `ValidationDiscordRole` FROM `ValidationDiscordRole` LEFT JOIN `ValidationDiscordGuild` ON `ValidationDiscordGuild`.`id` = `ValidationDiscordRole`.`guildId` WHERE `ValidationDiscordGuild`.`id` IS NULL;--> statement-breakpoint
ALTER TABLE `FormIntegration` MODIFY COLUMN `owner_user_id` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `FormIntegration` MODIFY COLUMN `user_id` varchar(191);--> statement-breakpoint
ALTER TABLE `FormInvitation` MODIFY COLUMN `invitedBy` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `FormShareLink` MODIFY COLUMN `createdBy` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `FormSnapshot` MODIFY COLUMN `publishedBy` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `FormStructure` MODIFY COLUMN `createdBy` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `UserInvite` MODIFY COLUMN `invitedBy` varchar(191) NOT NULL;--> statement-breakpoint
ALTER TABLE `FormIntegration` ADD CONSTRAINT `FormIntegration_owner_user_id_User_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormIntegration` ADD CONSTRAINT `FormIntegration_user_id_User_id_fk` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormInvitation` ADD CONSTRAINT `FormInvitation_invitedBy_User_id_fk` FOREIGN KEY (`invitedBy`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormShareLink` ADD CONSTRAINT `FormShareLink_createdBy_User_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormSnapshot` ADD CONSTRAINT `FormSnapshot_publishedBy_User_id_fk` FOREIGN KEY (`publishedBy`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `FormStructure` ADD CONSTRAINT `FormStructure_createdBy_User_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `UserInvite` ADD CONSTRAINT `UserInvite_invitedBy_User_id_fk` FOREIGN KEY (`invitedBy`) REFERENCES `User`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ValidationDiscordRole` ADD CONSTRAINT `ValidationDiscordRole_guildId_ValidationDiscordGuild_id_fk` FOREIGN KEY (`guildId`) REFERENCES `ValidationDiscordGuild`(`id`) ON DELETE cascade ON UPDATE no action;
