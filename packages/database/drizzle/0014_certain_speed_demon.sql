CREATE TEMPORARY TABLE `FormStructureVersionRenumbering` (
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
DROP TEMPORARY TABLE `FormStructureVersionRenumbering`;--> statement-breakpoint
CREATE TEMPORARY TABLE `FormStructureActiveNormalization` (
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
DROP TEMPORARY TABLE `FormStructureActiveNormalization`;--> statement-breakpoint
ALTER TABLE `FormStructure` ADD `activeFormId` varchar(128) GENERATED ALWAYS AS (case when `isActive` then `formId` else null end) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX `FormStructure_formId_version_key` ON `FormStructure` (`formId`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `FormStructure_activeFormId_key` ON `FormStructure` (`activeFormId`);
