export const formLogicStructureQueryKey = (formId: string) =>
  ["formStructure", "logic", formId] as const;

export const formAccessControlStructureQueryKey = (formId: string) =>
  ["formStructure", "accessControl", formId] as const;

export const formDiffQueryKey = (formId: string | null | undefined) =>
  ["formDiff", formId] as const;

export const unpublishedChangesQueryKey = (formId: string | null | undefined) =>
  ["unpublishedChanges", formId] as const;
