-- Rename config_json to configJson and change type from TEXT to JSON in FormIntegration table.
-- MySQL will reject invalid JSON rows during the ALTER; validate data beforehand if migrating an existing database.
ALTER TABLE `FormIntegration` CHANGE `config_json` `configJson` JSON NOT NULL;
