UPDATE `FormStructure` AS `Target`
INNER JOIN (
  SELECT
    `DuplicateRows`.`id`,
    `MaxVersions`.`maxVersion` + ROW_NUMBER() OVER (
      PARTITION BY `DuplicateRows`.`formId`
      ORDER BY
        `DuplicateRows`.`version` ASC,
        `DuplicateRows`.`createdAt` ASC,
        `DuplicateRows`.`id` ASC
    ) AS `nextVersion`
  FROM (
    SELECT
      `id`,
      `formId`,
      `version`,
      `createdAt`,
      ROW_NUMBER() OVER (
        PARTITION BY `formId`, `version`
        ORDER BY `createdAt` ASC, `id` ASC
      ) AS `duplicateRank`
    FROM `FormStructure`
  ) AS `DuplicateRows`
  INNER JOIN (
    SELECT `formId`, MAX(`version`) AS `maxVersion`
    FROM `FormStructure`
    GROUP BY `formId`
  ) AS `MaxVersions`
    ON `MaxVersions`.`formId` = `DuplicateRows`.`formId`
  WHERE `DuplicateRows`.`duplicateRank` > 1
) AS `Renumbered`
  ON `Renumbered`.`id` = `Target`.`id`
SET `Target`.`version` = `Renumbered`.`nextVersion`;--> statement-breakpoint
UPDATE `FormStructure` AS `Target`
INNER JOIN (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `formId`
      ORDER BY `version` DESC, `createdAt` DESC, `id` DESC
    ) AS `activeRank`
  FROM `FormStructure`
  WHERE `isActive` = true
) AS `RankedActive`
  ON `RankedActive`.`id` = `Target`.`id`
SET `Target`.`isActive` = false
WHERE `RankedActive`.`activeRank` > 1;--> statement-breakpoint
ALTER TABLE `FormStructure` ADD `activeFormId` varchar(128) GENERATED ALWAYS AS (case when isActive then formId else null end) STORED;--> statement-breakpoint
ALTER TABLE `FormStructure` ADD CONSTRAINT `FormStructure_formId_version_key` UNIQUE(`formId`,`version`);--> statement-breakpoint
ALTER TABLE `FormStructure` ADD CONSTRAINT `FormStructure_activeFormId_key` UNIQUE(`activeFormId`);
