-- Preserve pre-snapshot live public security behavior for existing tenants.
-- Before structure snapshots, public routes read the active FormStructure. The
-- 0011 backfill populated snapshots from publish-time structure, so forms that
-- changed password protection, response limits, or fingerprint requirements
-- after publishing could be downgraded. Reconcile active snapshots only; older
-- inactive snapshots remain historical publish records.
UPDATE `FormSnapshot` AS `Snapshot`
INNER JOIN (
  SELECT `formId`, `structureJson`
  FROM (
    SELECT
      `formId`,
      `structureJson`,
      ROW_NUMBER() OVER (
        PARTITION BY `formId`
        ORDER BY
          `version` DESC,
          `createdAt` DESC,
          `id` DESC
      ) AS `rowNumber`
    FROM `FormStructure`
    WHERE `isActive` = true
  ) AS `ActiveStructureCandidates`
  WHERE `rowNumber` = 1
) AS `LatestActiveStructure`
  ON `LatestActiveStructure`.`formId` = `Snapshot`.`formId`
SET `Snapshot`.`structureJson` = `LatestActiveStructure`.`structureJson`
WHERE `Snapshot`.`isActive` = true;
