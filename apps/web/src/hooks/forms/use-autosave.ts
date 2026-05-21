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
const generateKey = (formId: string, respondentUuid: string): string =>
  `${keyPrefix}:${formId}:${respondentUuid}`;
const generateRespondentKey = (formId: string): string =>
  `cf:respondent:${formId}`;

const resolveRespondentUuid = (formId: string): string => {
  if (typeof window === "undefined") return "";

  const storageKey = generateRespondentKey(formId);
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;

  const nextId = crypto.randomUUID();
  window.localStorage.setItem(storageKey, nextId);
  return nextId;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

type RespondentIdentity = {
  formId: string;
  uuid: string;
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
  const respondentRef = useRef<RespondentIdentity | null>(null);
  const lastHashRef = useRef<string>("");

  const getRespondentUuid = useCallback((): string => {
    if (
      respondentRef.current?.formId === formId &&
      respondentRef.current.uuid
    ) {
      return respondentRef.current.uuid;
    }

    const uuid = resolveRespondentUuid(formId);
    respondentRef.current = { formId, uuid };
    return uuid;
  }, [formId]);

  const saveNow = useCallback(async () => {
    if (!enabled || typeof window === "undefined") return;
    const respondentUuid = getRespondentUuid();
    if (!respondentUuid) return;
    if (!isRecord(responses)) return;

    const responseHash = JSON.stringify({
      formId,
      respondentUuid,
      responses,
    });
    if (responseHash === lastHashRef.current) return;

    setState((current) => ({ ...current, isSaving: true, error: null }));

    try {
      const payload: AutosaveData = {
        formId,
        respondentUuid,
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
  }, [enabled, formId, getRespondentUuid, responses]);

  const loadDraft = useCallback(() => {
    if (typeof window === "undefined") return null;
    const respondentUuid = getRespondentUuid();
    if (!respondentUuid) return null;

    const raw = window.localStorage.getItem(
      generateKey(formId, respondentUuid),
    );
    if (!raw) return null;

    const json = safeJsonParse(raw);
    if (json === undefined) return null;

    const parsed = autosaveDataSchema.safeParse(json);
    if (!parsed.success) return null;

    return parsed.data;
  }, [formId, getRespondentUuid]);

  const clearDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    const respondentUuid = getRespondentUuid();
    if (respondentUuid) {
      window.localStorage.removeItem(generateKey(formId, respondentUuid));
    }
    setState((current) => ({ ...current, lastSaved: null, error: null }));
    lastHashRef.current = "";
  }, [formId, getRespondentUuid]);

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
