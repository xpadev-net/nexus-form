const stringSchema = {
  parse(value) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("Expected a non-empty string");
    }
    return value;
  },
};

const configSchema = {
  parse(value) {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof value.expectedValue !== "string"
    ) {
      throw new Error("expectedValue must be a string");
    }
    return value;
  },
  safeParse(value) {
    try {
      return { success: true, data: this.parse(value) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
};

const metadataSchema = {
  safeParse(value) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return { success: true, data: value };
    }
    return {
      success: false,
      error: new Error("Metadata must be an object"),
    };
  },
};

const provider = {
  name: "e2e_validation",
  label: "CI deterministic validation",
  description: "Deterministic provider used only by the PR E2E harness",
  rules: {
    matches_fixture: {
      name: "matches_fixture",
      label: "Matches CI fixture",
      description: "Checks the submitted value against a deterministic fixture",
      inputHint: "CI fixture value",
      inputSchema: stringSchema,
      configSchema,
      metadataSchema,
      async validate(input, config) {
        const isValid = input === config.expectedValue;
        return {
          isValid,
          metadata: { fixture: "ci", input },
          ...(isValid
            ? {}
            : {
                errorCode: "CI_FIXTURE_MISMATCH",
                errorMessage: "Input did not match the CI fixture",
              }),
        };
      },
    },
  },
};

export default provider;
