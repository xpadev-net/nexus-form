-- Rename config_json to configJson and change type from TEXT to JSON in FormIntegration table.
-- Fail before ALTER with the affected row ids when existing config_json values are not valid JSON.
SET @legacyConfigJsonColumns = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'FormIntegration'
    AND COLUMN_NAME = 'config_json'
);--> statement-breakpoint
SET @currentConfigJsonColumns = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'FormIntegration'
    AND COLUMN_NAME = 'configJson'
);--> statement-breakpoint
DROP TABLE IF EXISTS `ConfigJsonColumnTypePreflightFailure`;--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE `ConfigJsonColumnTypePreflightFailure` (
  `id` varchar(128) NOT NULL,
  `reason` varchar(255) NOT NULL,
  UNIQUE KEY `ConfigJsonPreflightBeforeAlterInvalidId` (`id`)
);--> statement-breakpoint
SET @preflightSql = IF(
  @legacyConfigJsonColumns > 0,
  'INSERT INTO `ConfigJsonColumnTypePreflightFailure` (`id`, `reason`) SELECT `id`, ''0012 preflight before ALTER failed: invalid FormIntegration.config_json'' FROM `FormIntegration` WHERE COALESCE(JSON_VALID(`config_json`), 0) = 0',
  'SELECT 1'
);--> statement-breakpoint
PREPARE preflightStmt FROM @preflightSql;--> statement-breakpoint
EXECUTE preflightStmt;--> statement-breakpoint
DEALLOCATE PREPARE preflightStmt;--> statement-breakpoint
SET @preflightFailureCount = (
  SELECT COUNT(*)
  FROM `ConfigJsonColumnTypePreflightFailure`
);--> statement-breakpoint
SET @duplicateFailureSql = IF(
  @preflightFailureCount > 0,
  'INSERT INTO `ConfigJsonColumnTypePreflightFailure` (`id`, `reason`) SELECT `id`, `reason` FROM `ConfigJsonColumnTypePreflightFailure` ORDER BY `id` LIMIT 1',
  'SELECT 1'
);--> statement-breakpoint
PREPARE duplicateFailureStmt FROM @duplicateFailureSql;--> statement-breakpoint
EXECUTE duplicateFailureStmt;--> statement-breakpoint
DEALLOCATE PREPARE duplicateFailureStmt;--> statement-breakpoint
DROP TABLE `ConfigJsonColumnTypePreflightFailure`;--> statement-breakpoint
SET @alterSql = IF(
  @legacyConfigJsonColumns > 0 AND @currentConfigJsonColumns = 0,
  'ALTER TABLE `FormIntegration` CHANGE `config_json` `configJson` JSON NOT NULL',
  'SELECT 1'
);--> statement-breakpoint
PREPARE alterColumnStmt FROM @alterSql;--> statement-breakpoint
EXECUTE alterColumnStmt;--> statement-breakpoint
DEALLOCATE PREPARE alterColumnStmt;--> statement-breakpoint
