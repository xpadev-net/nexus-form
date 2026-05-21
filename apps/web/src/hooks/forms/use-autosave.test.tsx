// @vitest-environment jsdom

import { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "./use-autosave";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type AutosaveControls = ReturnType<typeof useAutosave>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const createAutosaveKey = (formId: string, respondentUuid: string): string =>
  `cf:autosave:${formId}:${respondentUuid}`;

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function AutosaveProbe({
  enabled = false,
  formId,
  layoutKey = formId,
  onLayout,
}: {
  enabled?: boolean;
  formId: string;
  layoutKey?: string;
  onLayout: (controls: AutosaveControls) => void;
}): null {
  const lastLayoutKeyRef = useRef<string | null>(null);
  const controls = useAutosave(
    formId,
    {
      question1: "answer",
    },
    { enabled },
  );

  useLayoutEffect(() => {
    if (lastLayoutKeyRef.current === layoutKey) return;
    lastLayoutKeyRef.current = layoutKey;
    onLayout(controls);
  }, [controls, layoutKey, onLayout]);

  return null;
}

describe("useAutosave", () => {
  beforeEach(() => {
    const storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it("loads a draft with the persisted respondent UUID before passive effects run", () => {
    const formId = "form-1";
    const respondentUuid = "respondent-1";
    const draft = {
      formId,
      respondentUuid,
      responses: {
        question1: "saved answer",
      },
      savedAt: "2026-05-21T00:00:00.000Z",
      version: 1,
    };
    window.localStorage.setItem(`cf:respondent:${formId}`, respondentUuid);
    window.localStorage.setItem(
      createAutosaveKey(formId, respondentUuid),
      JSON.stringify(draft),
    );

    let loadedDraft: unknown = null;
    act(() => {
      root?.render(
        <AutosaveProbe
          formId={formId}
          onLayout={(controls) => {
            loadedDraft = controls.loadDraft();
          }}
        />,
      );
    });

    expect(loadedDraft).toEqual(draft);
  });

  it("clears a draft with the persisted respondent UUID before passive effects run", () => {
    const formId = "form-1";
    const respondentUuid = "respondent-1";
    const autosaveKey = createAutosaveKey(formId, respondentUuid);
    window.localStorage.setItem(`cf:respondent:${formId}`, respondentUuid);
    window.localStorage.setItem(
      autosaveKey,
      JSON.stringify({
        formId,
        respondentUuid,
        responses: {
          question1: "saved answer",
        },
        savedAt: "2026-05-21T00:00:00.000Z",
        version: 1,
      }),
    );

    act(() => {
      root?.render(
        <AutosaveProbe
          formId={formId}
          onLayout={(controls) => {
            controls.clearDraft();
          }}
        />,
      );
    });

    expect(window.localStorage.getItem(autosaveKey)).toBeNull();
  });

  it("loads a draft with the new form respondent UUID before passive effects run after formId changes", () => {
    const initialFormId = "form-1";
    const nextFormId = "form-2";
    window.localStorage.setItem(`cf:respondent:${initialFormId}`, "old-user");
    window.localStorage.setItem(`cf:respondent:${nextFormId}`, "next-user");

    const nextDraft = {
      formId: nextFormId,
      respondentUuid: "next-user",
      responses: {
        question1: "next saved answer",
      },
      savedAt: "2026-05-21T00:00:00.000Z",
      version: 1,
    };
    window.localStorage.setItem(
      createAutosaveKey(nextFormId, "old-user"),
      JSON.stringify({
        ...nextDraft,
        respondentUuid: "old-user",
        responses: {
          question1: "wrong draft",
        },
      }),
    );
    window.localStorage.setItem(
      createAutosaveKey(nextFormId, "next-user"),
      JSON.stringify(nextDraft),
    );

    const loadedDrafts: Array<unknown> = [];
    act(() => {
      root?.render(
        <AutosaveProbe
          formId={initialFormId}
          onLayout={(controls) => {
            loadedDrafts.push(controls.loadDraft());
          }}
        />,
      );
    });
    act(() => {
      root?.render(
        <AutosaveProbe
          formId={nextFormId}
          layoutKey={nextFormId}
          onLayout={(controls) => {
            loadedDrafts.push(controls.loadDraft());
          }}
        />,
      );
    });

    expect(loadedDrafts.at(-1)).toEqual(nextDraft);
  });

  it("clears a draft with the new form respondent UUID before passive effects run after formId changes", () => {
    const initialFormId = "form-1";
    const nextFormId = "form-2";
    const nextAutosaveKey = createAutosaveKey(nextFormId, "next-user");
    const staleAutosaveKey = createAutosaveKey(nextFormId, "old-user");
    window.localStorage.setItem(`cf:respondent:${initialFormId}`, "old-user");
    window.localStorage.setItem(`cf:respondent:${nextFormId}`, "next-user");
    window.localStorage.setItem(
      staleAutosaveKey,
      JSON.stringify({
        formId: nextFormId,
        respondentUuid: "old-user",
        responses: {
          question1: "stale",
        },
        savedAt: "2026-05-21T00:00:00.000Z",
        version: 1,
      }),
    );
    window.localStorage.setItem(
      nextAutosaveKey,
      JSON.stringify({
        formId: nextFormId,
        respondentUuid: "next-user",
        responses: {
          question1: "saved answer",
        },
        savedAt: "2026-05-21T00:00:00.000Z",
        version: 1,
      }),
    );

    act(() => {
      root?.render(
        <AutosaveProbe formId={initialFormId} onLayout={() => undefined} />,
      );
    });
    act(() => {
      root?.render(
        <AutosaveProbe
          formId={nextFormId}
          layoutKey={nextFormId}
          onLayout={(controls) => {
            controls.clearDraft();
          }}
        />,
      );
    });

    expect(window.localStorage.getItem(nextAutosaveKey)).toBeNull();
    expect(window.localStorage.getItem(staleAutosaveKey)).not.toBeNull();
  });

  it("saves a draft for the new form when formId changes with unchanged responses", async () => {
    const initialFormId = "form-1";
    const nextFormId = "form-2";
    window.localStorage.setItem(`cf:respondent:${initialFormId}`, "old-user");
    window.localStorage.setItem(`cf:respondent:${nextFormId}`, "next-user");

    let latestControls: AutosaveControls | null = null;
    act(() => {
      root?.render(
        <AutosaveProbe
          enabled
          formId={initialFormId}
          onLayout={(controls) => {
            latestControls = controls;
          }}
        />,
      );
    });
    await act(async () => {
      await latestControls?.saveManually();
    });

    act(() => {
      root?.render(
        <AutosaveProbe
          enabled
          formId={nextFormId}
          layoutKey={nextFormId}
          onLayout={(controls) => {
            latestControls = controls;
          }}
        />,
      );
    });
    await act(async () => {
      await latestControls?.saveManually();
    });

    expect(
      window.localStorage.getItem(createAutosaveKey(nextFormId, "next-user")),
    ).not.toBeNull();
  });
});
