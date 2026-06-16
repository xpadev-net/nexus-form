-- Rename config_json to configJson and change type from TEXT to JSON in FormIntegration table.
-- Fail before ALTER with the affected row ids when existing config_json values are not valid JSON.
DROP TABLE IF EXISTS `ConfigJsonColumnTypePreflightFailure`;--> statement-breakpoint
CREATE TABLE `ConfigJsonColumnTypePreflightFailure` (
  `id` varchar(128) NOT NULL,
  `reason` varchar(255) NOT NULL,
  UNIQUE KEY `ConfigJsonPreflightBeforeAlterInvalidId` (`id`)
);--> statement-breakpoint
INSERT INTO `ConfigJsonColumnTypePreflightFailure` (`id`, `reason`)
SELECT
  `id`,
  '0012 preflight before ALTER failed: invalid FormIntegration.config_json'
FROM `FormIntegration`
WHERE COALESCE(JSON_VALID(`config_json`), 0) = 0;--> statement-breakpoint
-- If invalid rows were captured above, fail before the ALTER by duplicating the first captured id.
INSERT INTO `ConfigJsonColumnTypePreflightFailure` (`id`, `reason`)
SELECT `id`, `reason`
FROM `ConfigJsonColumnTypePreflightFailure`
ORDER BY `id`
LIMIT 1;--> statement-breakpoint
DROP TABLE `ConfigJsonColumnTypePreflightFailure`;--> statement-breakpoint
ALTER TABLE `FormIntegration` CHANGE `config_json` `configJson` JSON NOT NULL;
