import { describe, expect, it } from "vitest";
import {
  buildResponseExportValidationOutputColumns,
  type ResponseExportRecord,
} from "../response-export";

describe("buildResponseExportValidationOutputColumns", () => {
  it("uses a stable provider/type/id header for enabled settings without results", () => {
    const columns = buildResponseExportValidationOutputColumns(
      {
        values: [
          {
            rule_id: "rule-gh",
            provider_name: "github",
            rule_type: "membership",
            output_key: "profile_score",
            enabled: true,
          },
        ],
      },
      [],
    );

    expect(columns).toMatchObject([
      {
        id: "validation_output:rule-gh:profile_score",
        title:
          "Validation: github:membership:rule-gh / Profile Score [profile_score]",
        ruleName: "github:membership:rule-gh",
      },
    ]);
  });
});

describe("ResponseExportRecord validation metadata", () => {
  it("can represent match, mismatch, and unchecked pattern statuses", () => {
    const record: ResponseExportRecord = {
      metadata: {
        id: "response-1",
        form_id: "form-1",
        respondent_uuid: "respondent-1",
        submitted_at: "2026-07-07T00:00:00.000Z",
      },
      component_columns: [
        {
          block_id: "short-text",
          block_type: "short_text",
          value: "NF-123",
          validation_metadata: {
            pattern_match: {
              status: "match",
              mode: "warn",
            },
          },
        },
        {
          block_id: "radio-other",
          block_type: "radio",
          value: "other",
          display_value: "Custom",
          validation_metadata: {
            other_text_pattern_match: {
              status: "mismatch",
              mode: "hidden",
            },
          },
        },
        {
          block_id: "legacy-short-text",
          block_type: "short_text",
          value: "legacy",
          validation_metadata: {
            pattern_match: {
              status: "unchecked",
            },
          },
        },
      ],
    };

    expect(
      record.component_columns.map(
        (column) =>
          column.validation_metadata?.pattern_match?.status ??
          column.validation_metadata?.other_text_pattern_match?.status,
      ),
    ).toEqual(["match", "mismatch", "unchecked"]);
  });
});
