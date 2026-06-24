DROP TABLE IF EXISTS `FormStructureVersionRenumbering`;--> statement-breakpoint
CREATE TABLE `FormStructureVersionRenumbering` (
  `id` varchar(128) NOT NULL,
  `nextVersion` int NOT NULL,
  PRIMARY KEY (`id`)
);--> statement-breakpoint
INSERT INTO `FormStructureVersionRenumbering` (`id`, `nextVersion`)
SELECT
  `Renumbered`.`id`,
  `Renumbered`.`nextVersion`
FROM (
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
) AS `Renumbered`;--> statement-breakpoint
UPDATE `FormStructure` AS `Target`
INNER JOIN `FormStructureVersionRenumbering` AS `Renumbered`
  ON `Renumbered`.`id` = `Target`.`id`
SET `Target`.`version` = `Renumbered`.`nextVersion`;--> statement-breakpoint
DROP TABLE `FormStructureVersionRenumbering`;--> statement-breakpoint
DROP TABLE IF EXISTS `FormStructureActiveNormalization`;--> statement-breakpoint
CREATE TABLE `FormStructureActiveNormalization` (
  `id` varchar(128) NOT NULL,
  PRIMARY KEY (`id`)
);--> statement-breakpoint
INSERT INTO `FormStructureActiveNormalization` (`id`)
SELECT `RankedActive`.`id`
FROM (
  SELECT
    `id`,
    ROW_NUMBER() OVER (
      PARTITION BY `formId`
      ORDER BY `version` DESC, `createdAt` DESC, `id` DESC
    ) AS `activeRank`
  FROM `FormStructure`
  WHERE `isActive` = true
) AS `RankedActive`
WHERE `RankedActive`.`activeRank` > 1;--> statement-breakpoint
UPDATE `FormStructure` AS `Target`
INNER JOIN `FormStructureActiveNormalization` AS `RankedActive`
  ON `RankedActive`.`id` = `Target`.`id`
SET `Target`.`isActive` = false;--> statement-breakpoint
DROP TABLE `FormStructureActiveNormalization`;--> statement-breakpoint
SET @nf_active_form_id_column_exists = (
  SELECT COUNT(*)
  FROM `INFORMATION_SCHEMA`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'FormStructure'
    AND `COLUMN_NAME` = 'activeFormId'
);--> statement-breakpoint
SET @nf_add_active_form_id_column = IF(
  @nf_active_form_id_column_exists > 0,
  'SELECT 1',
  'ALTER TABLE `FormStructure` ADD `activeFormId` varchar(128)'
);--> statement-breakpoint
PREPARE nf_add_active_form_id_column_stmt FROM @nf_add_active_form_id_column;--> statement-breakpoint
EXECUTE nf_add_active_form_id_column_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_add_active_form_id_column_stmt;--> statement-breakpoint
-- Always resync activeFormId so a retry after a partial DDL failure repairs existing rows.
UPDATE `FormStructure`
SET `activeFormId` = CASE
  WHEN `isActive` = true THEN `formId`
  ELSE NULL
END;--> statement-breakpoint
SET @nf_form_id_version_index_exists = (
  SELECT COUNT(*)
  FROM `INFORMATION_SCHEMA`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'FormStructure'
    AND `INDEX_NAME` = 'FormStructure_formId_version_key'
);--> statement-breakpoint
SET @nf_create_form_id_version_index = IF(
  @nf_form_id_version_index_exists > 0,
  'SELECT 1',
  'CREATE UNIQUE INDEX `FormStructure_formId_version_key` ON `FormStructure` (`formId`,`version`)'
);--> statement-breakpoint
PREPARE nf_create_form_id_version_index_stmt FROM @nf_create_form_id_version_index;--> statement-breakpoint
EXECUTE nf_create_form_id_version_index_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_create_form_id_version_index_stmt;--> statement-breakpoint
SET @nf_active_form_id_index_exists = (
  SELECT COUNT(*)
  FROM `INFORMATION_SCHEMA`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'FormStructure'
    AND `INDEX_NAME` = 'FormStructure_activeFormId_key'
);--> statement-breakpoint
SET @nf_create_active_form_id_index = IF(
  @nf_active_form_id_index_exists > 0,
  'SELECT 1',
  'CREATE UNIQUE INDEX `FormStructure_activeFormId_key` ON `FormStructure` (`activeFormId`)'
);--> statement-breakpoint
PREPARE nf_create_active_form_id_index_stmt FROM @nf_create_active_form_id_index;--> statement-breakpoint
EXECUTE nf_create_active_form_id_index_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_create_active_form_id_index_stmt;
