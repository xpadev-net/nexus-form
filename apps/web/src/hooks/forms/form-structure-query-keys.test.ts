import {
  formAccessControlStructureQueryKey,
  formLogicStructureQueryKey,
} from "./form-structure-query-keys";

describe("form structure query keys", () => {
  it("separates logic and access-control cache keys for the same form id", () => {
    const formId = "form-123";

    const logicKey = formLogicStructureQueryKey(formId);
    const accessControlKey = formAccessControlStructureQueryKey(formId);

    expect(logicKey).toEqual(["formStructure", "logic", formId]);
    expect(accessControlKey).toEqual([
      "formStructure",
      "accessControl",
      formId,
    ]);
    expect(logicKey).not.toEqual(accessControlKey);
  });
});
