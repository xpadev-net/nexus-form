-- Verify all existing rows contain valid JSON before conversion
SELECT COUNT(*) AS invalid_rows FROM `FormIntegration` WHERE JSON_VALID(`config_json`) = 0;

-- Rename config_json to configJson and change type from TEXT to JSON in FormIntegration table
ALTER TABLE `FormIntegration` CHANGE `config_json` `configJson` JSON NOT NULL;
