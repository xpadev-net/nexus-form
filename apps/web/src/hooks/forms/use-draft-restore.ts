import { useCallback, useMemo } from "react";
import {
  type AutosaveData,
  autosaveDataSchema,
  safeJsonParse,
} from "./schemas";

const keyPrefix = "cf:autosave";

const findDraft = (formId: string): AutosaveData | null => {
  if (typeof window === "undefined") return null;

  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith(`${keyPrefix}:${formId}:`)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;

    const json = safeJsonParse(raw);
    if (json === undefined) continue;

    const parsed = autosaveDataSchema.safeParse(json);
    if (parsed.success) {
      return parsed.data;
    }
  }

  return null;
};

export const useDraftRestore = (formId: string) => {
  const draftData = useMemo(() => findDraft(formId), [formId]);

  const discardDraft = useCallback(() => {
    if (!draftData || typeof window === "undefined") return;
    window.localStorage.removeItem(
      `${keyPrefix}:${draftData.formId}:${draftData.respondentUuid}`,
    );
  }, [draftData]);

  return {
    hasDraft: draftData !== null,
    draftData,
    restoreDraft: () => draftData?.responses ?? null,
    discardDraft,
    isCheckingDraft: false,
  };
};
