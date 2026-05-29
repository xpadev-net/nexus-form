-- Rename config_json to configJson and change type from TEXT to JSON in formIntegration table
ALTER TABLE `formIntegration` CHANGE `config_json` `configJson` JSON NOT NULL;
