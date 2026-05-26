import FingerprintJS from "@fingerprintjs/fingerprintjs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getFingerprintData } from "thumbmarkjs";
import { z } from "zod";
import { client, rpc } from "@/lib/api";

export type FingerprintType = "browser" | "fingerprintjs" | "thumbmarkjs";

const fingerprintComponentSchema = z.object({
  componentName: z.string(),
  componentValue: z.string(),
  componentValueHash: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

const collectedFingerprintSchema = z.object({
  fingerprintType: z.string(),
  components: z.array(fingerprintComponentSchema),
});

const hashString = async (value: string): Promise<string> => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const serializedHash = async (value: unknown): Promise<string> => {
  if (value === undefined || value === null) return hashString("");
  if (typeof value === "string") return hashString(value);
  return hashString(JSON.stringify(value));
};

const collectDefaultFingerprint = async () => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const language = navigator.language;
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ?? navigator.platform;
  const userAgent = navigator.userAgent;

  const [timezoneHash, languageHash, platformHash, userAgentHash] =
    await Promise.all([
      hashString(timezone),
      hashString(language),
      hashString(platform),
      hashString(userAgent),
    ]);

  return collectedFingerprintSchema.parse({
    fingerprintType: "browser",
    components: [
      {
        componentName: "timezone",
        componentValue: timezone,
        componentValueHash: timezoneHash,
      },
      {
        componentName: "language",
        componentValue: language,
        componentValueHash: languageHash,
      },
      {
        componentName: "platform",
        componentValue: platform,
        componentValueHash: platformHash,
      },
      {
        componentName: "userAgent",
        componentValue: userAgent,
        componentValueHash: userAgentHash,
      },
    ],
  });
};

const collectFingerprintJS = async () => {
  const fp = await FingerprintJS.load();
  const result = await fp.get();

  const rawComponents = result.components as Record<
    string,
    { value?: unknown; error?: unknown; duration: number }
  >;

  const componentEntries = await Promise.all(
    Object.entries(rawComponents).map(async ([name, comp]) => {
      const rawValue =
        comp && "error" in comp && comp.error !== undefined
          ? `error:${String(comp.error)}`
          : comp?.value;
      const strValue =
        rawValue !== undefined && rawValue !== null
          ? String(rawValue)
          : "undefined";
      const valueHash = await serializedHash(rawValue);
      return {
        componentName: name,
        componentValue: strValue,
        componentValueHash: valueHash,
      };
    }),
  );

  const visitorIdHash = await hashString(result.visitorId);

  return collectedFingerprintSchema.parse({
    fingerprintType: "fingerprintjs",
    components: [
      ...componentEntries,
      {
        componentName: "visitorId",
        componentValue: result.visitorId,
        componentValueHash: visitorIdHash,
      },
    ],
  });
};

const collectThumbmarkJS = async () => {
  const data = await getFingerprintData();

  const componentEntries = await Promise.all(
    Object.entries(data).map(async ([name, value]) => {
      const valueHash = await serializedHash(value);
      return {
        componentName: name,
        componentValue: String(value ?? "undefined"),
        componentValueHash: valueHash,
      };
    }),
  );

  return collectedFingerprintSchema.parse({
    fingerprintType: "thumbmarkjs",
    components: componentEntries,
  });
};

const collectAll = async () => {
  const results = await Promise.allSettled([
    collectDefaultFingerprint(),
    collectFingerprintJS(),
    collectThumbmarkJS(),
  ]);

  const collected: z.infer<typeof collectedFingerprintSchema>[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      collected.push(result.value);
    } else {
      console.error("[fingerprint] collector failed:", result.reason);
    }
  }
  return collected;
};

export const useFingerprint = (options?: { autoCollect?: boolean }) => {
  const collectedRef = useRef(false);

  const collectMutation = useMutation({
    mutationFn: collectAll,
  });
  const mutateAsyncRef = useRef(collectMutation.mutateAsync);
  mutateAsyncRef.current = collectMutation.mutateAsync;

  const saveMutation = useMutation({
    mutationFn: ({
      responseId,
      collected,
    }: {
      responseId: string;
      collected: z.infer<typeof collectedFingerprintSchema>;
    }) =>
      rpc(
        client.api.fingerprint.save.$post({
          json: {
            responseId,
            fingerprintType: collected.fingerprintType,
            components: collected.components,
          },
        }),
      ),
  });

  useEffect(() => {
    if (options?.autoCollect && !collectedRef.current) {
      collectedRef.current = true;
      void mutateAsyncRef.current();
    }
  }, [options?.autoCollect]);

  return {
    fingerprints: collectMutation.data ?? [],
    isLoading: collectMutation.isPending,
    error: collectMutation.error,
    collect: collectMutation.mutateAsync,
    clear: collectMutation.reset,
    saveMutation,
  };
};

export const useFingerprintManage = (
  responseId?: string,
  formId?: string,
  includeStats?: boolean,
) => {
  const query = useQuery({
    queryKey: ["fingerprints", responseId, formId, includeStats],
    enabled: Boolean(responseId || formId),
    queryFn: () => {
      const queryParams: Record<string, string> = {};
      if (responseId) queryParams.responseId = responseId;
      if (formId) queryParams.formId = formId;
      if (includeStats) queryParams.includeStats = "true";
      return rpc(client.api.fingerprint.get.$get({ query: queryParams }));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (beforeIso: string) =>
      rpc(
        client.api.fingerprint.manage.$delete({
          json: { responseId, formId, before: beforeIso },
        }),
      ),
  });

  return {
    query,
    deleteMutation,
  };
};
