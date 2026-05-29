-- Rename config_json to configJson and change type from TEXT to JSON in FormIntegration table
ALTER TABLE `FormIntegration` CHANGE `config_json` `configJson` JSON NOT NULL;
