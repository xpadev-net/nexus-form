SET @nf_claim_token_exists = (
  SELECT COUNT(*)
  FROM `INFORMATION_SCHEMA`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'ExternalServiceValidationResult'
    AND `COLUMN_NAME` = 'claimToken'
);--> statement-breakpoint
SET @nf_add_claim_token = IF(
  @nf_claim_token_exists > 0,
  'SELECT 1',
  'ALTER TABLE `ExternalServiceValidationResult` ADD `claimToken` varchar(128)'
);--> statement-breakpoint
PREPARE nf_add_claim_token_stmt FROM @nf_add_claim_token;--> statement-breakpoint
EXECUTE nf_add_claim_token_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_add_claim_token_stmt;--> statement-breakpoint
SET @nf_claim_expires_at_exists = (
  SELECT COUNT(*)
  FROM `INFORMATION_SCHEMA`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'ExternalServiceValidationResult'
    AND `COLUMN_NAME` = 'claimExpiresAt'
);--> statement-breakpoint
SET @nf_add_claim_expires_at = IF(
  @nf_claim_expires_at_exists > 0,
  'SELECT 1',
  'ALTER TABLE `ExternalServiceValidationResult` ADD `claimExpiresAt` timestamp'
);--> statement-breakpoint
PREPARE nf_add_claim_expires_at_stmt FROM @nf_add_claim_expires_at;--> statement-breakpoint
EXECUTE nf_add_claim_expires_at_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_add_claim_expires_at_stmt;--> statement-breakpoint
SET @nf_enqueue_attempt_count_exists = (
  SELECT COUNT(*)
  FROM `INFORMATION_SCHEMA`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'ExternalServiceValidationResult'
    AND `COLUMN_NAME` = 'enqueueAttemptCount'
);--> statement-breakpoint
SET @nf_add_enqueue_attempt_count = IF(
  @nf_enqueue_attempt_count_exists > 0,
  'SELECT 1',
  'ALTER TABLE `ExternalServiceValidationResult` ADD `enqueueAttemptCount` int DEFAULT 0 NOT NULL'
);--> statement-breakpoint
PREPARE nf_add_enqueue_attempt_count_stmt FROM @nf_add_enqueue_attempt_count;--> statement-breakpoint
EXECUTE nf_add_enqueue_attempt_count_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_add_enqueue_attempt_count_stmt;--> statement-breakpoint
SET @nf_next_eligible_at_exists = (
  SELECT COUNT(*)
  FROM `INFORMATION_SCHEMA`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'ExternalServiceValidationResult'
    AND `COLUMN_NAME` = 'nextEligibleAt'
);--> statement-breakpoint
SET @nf_add_next_eligible_at = IF(
  @nf_next_eligible_at_exists > 0,
  'SELECT 1',
  'ALTER TABLE `ExternalServiceValidationResult` ADD `nextEligibleAt` timestamp'
);--> statement-breakpoint
PREPARE nf_add_next_eligible_at_stmt FROM @nf_add_next_eligible_at;--> statement-breakpoint
EXECUTE nf_add_next_eligible_at_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_add_next_eligible_at_stmt;--> statement-breakpoint
SET @nf_enqueue_mode_exists = (
  SELECT COUNT(*)
  FROM `INFORMATION_SCHEMA`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'ExternalServiceValidationResult'
    AND `COLUMN_NAME` = 'validation_enqueue_mode'
);--> statement-breakpoint
SET @nf_add_enqueue_mode = IF(
  @nf_enqueue_mode_exists > 0,
  'SELECT 1',
  'ALTER TABLE `ExternalServiceValidationResult` ADD `validation_enqueue_mode` enum(''LEGACY'',''STABLE'') DEFAULT ''LEGACY'' NOT NULL'
);--> statement-breakpoint
PREPARE nf_add_enqueue_mode_stmt FROM @nf_add_enqueue_mode;--> statement-breakpoint
EXECUTE nf_add_enqueue_mode_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_add_enqueue_mode_stmt;--> statement-breakpoint
SET @nf_enqueue_eligibility_lease_idx_exists = (
  SELECT COUNT(*)
  FROM `INFORMATION_SCHEMA`.`STATISTICS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'ExternalServiceValidationResult'
    AND `INDEX_NAME` = 'ESVR_enqueue_eligibility_lease_idx'
);--> statement-breakpoint
SET @nf_create_enqueue_eligibility_lease_idx = IF(
  @nf_enqueue_eligibility_lease_idx_exists > 0,
  'SELECT 1',
  'CREATE INDEX `ESVR_enqueue_eligibility_lease_idx` ON `ExternalServiceValidationResult` (`validation_status`,`nextEligibleAt`,`claimExpiresAt`,`createdAt`)'
);--> statement-breakpoint
PREPARE nf_create_enqueue_eligibility_lease_idx_stmt FROM @nf_create_enqueue_eligibility_lease_idx;--> statement-breakpoint
EXECUTE nf_create_enqueue_eligibility_lease_idx_stmt;--> statement-breakpoint
DEALLOCATE PREPARE nf_create_enqueue_eligibility_lease_idx_stmt;
