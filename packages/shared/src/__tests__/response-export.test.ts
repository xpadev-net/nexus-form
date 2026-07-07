import { describe, expect, it } from "vitest";
import { buildResponseExportValidationOutputColumns } from "../response-export";

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
