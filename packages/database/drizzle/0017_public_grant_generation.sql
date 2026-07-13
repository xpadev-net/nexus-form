SET @nf_add_public_password_grant_generation = IF(
  (
    SELECT COUNT(*)
    FROM `INFORMATION_SCHEMA`.`COLUMNS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME` = 'Form'
      AND `COLUMN_NAME` = 'publicPasswordGrantGeneration'
  ) > 0,
  'SELECT 1',
  'ALTER TABLE `Form` ADD `publicPasswordGrantGeneration` bigint unsigned DEFAULT 1 NOT NULL'
);--> statement-breakpoint
PREPARE nf_add_public_password_grant_generation_stmt FROM @nf_add_public_password_grant_generation;--> statement-breakpoint
EXECUTE nf_add_public_password_grant_generation_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_add_public_password_grant_generation_stmt;
