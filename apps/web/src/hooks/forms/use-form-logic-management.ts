import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { client, rpc } from "@/lib/api";
import {
  formAccessControlStructureQueryKey,
  formLogicStructureQueryKey,
} from "./form-structure-query-keys";

async function fetchStructure(formId: string) {
  return rpc(client.api.forms[":id"].structure.$get({ param: { id: formId } }));
}

type FetchedStructure = Awaited<ReturnType<typeof fetchStructure>>;

type LogicRuleEntry = NonNullable<
  FetchedStructure["structure"]["logic"]
>[number];

async function saveLogic(
  formId: string,
  logic: NonNullable<FetchedStructure["structure"]["logic"]>,
) {
  return rpc(
    client.api.forms[":id"].structure.logic.$patch({
      param: { id: formId },
      json: { logic },
    }),
  );
}

export const useFormLogicManagement = (formId: string) => {
  const queryClient = useQueryClient();
  const mutexRef = useRef<Promise<unknown>>(Promise.resolve());

  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = mutexRef.current.catch(() => undefined).then(fn);
    mutexRef.current = next.catch(() => undefined);
    return next;
  };

  const structureQuery = useQuery({
    queryKey: formLogicStructureQueryKey(formId),
    queryFn: () => fetchStructure(formId),
    enabled: !!formId,
  });

  const rules = structureQuery.data?.structure.logic ?? [];

  const invalidateStructureQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: formLogicStructureQueryKey(formId),
      }),
      queryClient.invalidateQueries({
        queryKey: formAccessControlStructureQueryKey(formId),
      }),
    ]);

  const createRule = useMutation({
    mutationFn: (rule: Omit<LogicRuleEntry, "id">) =>
      serialized(async () => {
        const current = await fetchStructure(formId);
        const existingRules = current.structure.logic ?? [];
        const newRule = {
          ...rule,
          id: crypto.randomUUID(),
        };
        await saveLogic(formId, [...existingRules, newRule]);
        return newRule;
      }),
    onSuccess: async () => {
      await invalidateStructureQueries();
    },
  });

  const updateRule = useMutation({
    mutationFn: ({
      ruleId,
      id: _id,
      ...data
    }: Partial<LogicRuleEntry> & { ruleId: string }) =>
      serialized(async () => {
        const current = await fetchStructure(formId);
        const existingRules = current.structure.logic ?? [];
        if (!existingRules.some((r) => r.id === ruleId)) {
          throw new Error(`Logic rule ${ruleId} not found`);
        }
        // id は ruleId で特定するため、data からの上書きを防ぐ
        const updatedRules = existingRules.map((r) =>
          r.id === ruleId ? { ...r, ...data, id: ruleId } : r,
        );
        await saveLogic(formId, updatedRules);
      }),
    onSuccess: async () => {
      await invalidateStructureQueries();
    },
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) =>
      serialized(async () => {
        const current = await fetchStructure(formId);
        const existingRules = current.structure.logic ?? [];
        await saveLogic(
          formId,
          existingRules.filter((r) => r.id !== ruleId),
        );
      }),
    onSuccess: async () => {
      await invalidateStructureQueries();
    },
  });

  return {
    rules,
    isLoading: structureQuery.isLoading,
    error: structureQuery.error,
    createRule,
    updateRule,
    deleteRule,
  };
};
