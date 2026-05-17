export const formLogicStructureQueryKey = (formId: string) =>
  ["formStructure", "logic", formId] as const;

export const formAccessControlStructureQueryKey = (formId: string) =>
  ["formStructure", "accessControl", formId] as const;
