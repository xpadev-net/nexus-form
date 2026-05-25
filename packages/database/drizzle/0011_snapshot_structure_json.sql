ALTER TABLE `FormSnapshot` ADD `structureJson` text;--> statement-breakpoint
-- structureJson also has a Drizzle client default; this migration backfills existing rows.
UPDATE `FormSnapshot`
LEFT JOIN (
  SELECT
    `SnapshotForStructure`.`id` AS `snapshotId`,
    COALESCE(
      `PublishedStructure`.`structureJson`,
      `EarliestStructure`.`structureJson`
    ) AS `structureJson`
  FROM (
    SELECT `id`, `formId`
    FROM `FormSnapshot`
  ) AS `SnapshotForStructure`
  LEFT JOIN (
    SELECT `snapshotId`, `structureJson`
    FROM (
      SELECT
        `Snapshot`.`id` AS `snapshotId`,
        `Structure`.`structureJson`,
        ROW_NUMBER() OVER (
          PARTITION BY `Snapshot`.`id`
          ORDER BY
            `Structure`.`createdAt` DESC,
            `Structure`.`version` DESC,
            `Structure`.`id` DESC
        ) AS `rowNumber`
      FROM `FormSnapshot` AS `Snapshot`
      INNER JOIN `FormStructure` AS `Structure`
        ON `Structure`.`formId` = `Snapshot`.`formId`
        AND `Structure`.`createdAt` <= `Snapshot`.`publishedAt`
    ) AS `PublishedStructureCandidates`
    WHERE `rowNumber` = 1
  ) AS `PublishedStructure`
    ON `PublishedStructure`.`snapshotId` = `SnapshotForStructure`.`id`
  LEFT JOIN (
    SELECT `formId`, `structureJson`
    FROM (
      SELECT
        `formId`,
        `structureJson`,
        ROW_NUMBER() OVER (
          PARTITION BY `formId`
          ORDER BY
            `createdAt` ASC,
            `version` ASC,
            `id` ASC
        ) AS `rowNumber`
      FROM `FormStructure`
    ) AS `EarliestStructureCandidates`
    WHERE `rowNumber` = 1
  ) AS `EarliestStructure`
    ON `EarliestStructure`.`formId` = `SnapshotForStructure`.`formId`
) AS `SnapshotStructure`
  ON `SnapshotStructure`.`snapshotId` = `FormSnapshot`.`id`
SET `FormSnapshot`.`structureJson` = COALESCE(
  `SnapshotStructure`.`structureJson`,
  '{"version":1,"settings":{"allow_edit_responses":false}}'
)
WHERE `FormSnapshot`.`structureJson` IS NULL;--> statement-breakpoint
ALTER TABLE `FormSnapshot` MODIFY COLUMN `structureJson` text NOT NULL;
