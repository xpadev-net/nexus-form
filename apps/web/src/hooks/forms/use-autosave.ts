import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AutosaveData,
  autosaveDataSchema,
  safeJsonParse,
} from "./schemas";

type AutosaveState = {
  isSaving: boolean;
  lastSaved: Date | null;
  error: string | null;
};

const keyPrefix = "cf:autosave";
const generateKey = (formId: string, respondentUuid: string) =>
  `${keyPrefix}:${formId}:${respondentUuid}`;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const useAutosave = (
  formId: string,
  responses: Record<string, unknown>,
  options: { enabled?: boolean } = {},
) => {
  const [state, setState] = useState<AutosaveState>({
    isSaving: false,
    lastSaved: null,
    error: null,
  });

  const enabled = options.enabled ?? true;
  const timerRef = useRef<number | null>(null);
  const respondentUuidRef = useRef<string>("");
  const lastHashRef = useRef<string>("");
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || typeof window === "undefined") return;
    initializedRef.current = true;

    const storageKey = `cf:respondent:${formId}`;
    const existing = window.localStorage.getItem(storageKey);
    if (existing) {
      respondentUuidRef.current = existing;
    } else {
      const nextId = crypto.randomUUID();
      respondentUuidRef.current = nextId;
      window.localStorage.setItem(storageKey, nextId);
    }
  }, [formId]);

  const saveNow = useCallback(async () => {
    if (!enabled || typeof window === "undefined") return;
    if (!respondentUuidRef.current) return;
    if (!isRecord(responses)) return;

    const responseHash = JSON.stringify(responses);
    if (responseHash === lastHashRef.current) return;

    setState((current) => ({ ...current, isSaving: true, error: null }));

    try {
      const payload: AutosaveData = {
        formId,
        respondentUuid: respondentUuidRef.current,
        responses,
        savedAt: new Date().toISOString(),
        version: 1,
      };

      const parsed = autosaveDataSchema.parse(payload);
      window.localStorage.setItem(
        generateKey(parsed.formId, parsed.respondentUuid),
        JSON.stringify(parsed),
      );

      lastHashRef.current = responseHash;
      setState((current) => ({
        ...current,
        isSaving: false,
        lastSaved: new Date(),
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        isSaving: false,
        error:
          error instanceof Error ? error.message : "下書き保存に失敗しました",
      }));
    }
  }, [enabled, formId, responses]);

  const loadDraft = useCallback(() => {
    if (typeof window === "undefined") return null;

    const raw = window.localStorage.getItem(
      generateKey(formId, respondentUuidRef.current),
    );
    if (!raw) return null;

    const json = safeJsonParse(raw);
    if (json === undefined) return null;

    const parsed = autosaveDataSchema.safeParse(json);
    if (!parsed.success) return null;

    return parsed.data;
  }, [formId]);

  const clearDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(
      generateKey(formId, respondentUuidRef.current),
    );
    setState((current) => ({ ...current, lastSaved: null, error: null }));
    lastHashRef.current = "";
  }, [formId]);

  useEffect(() => {
    if (!enabled) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      void saveNow();
    }, 2000);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [enabled, saveNow]);

  return {
    ...state,
    saveManually: saveNow,
    loadDraft,
    clearDraft,
  };
};
