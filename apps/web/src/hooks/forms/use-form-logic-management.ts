import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { client, rpc } from "@/lib/api";

async function fetchStructure(formId: string) {
  return rpc(client.api.forms[":id"].structure.$get({ param: { id: formId } }));
}

type FetchedStructure = Awaited<ReturnType<typeof fetchStructure>>;

type LogicRuleEntry = NonNullable<
  FetchedStructure["structure"]["logic"]
>[number];

async function saveStructure(
  formId: string,
  structure: FetchedStructure["structure"],
  changeLog?: string,
) {
  return rpc(
    client.api.forms[":id"].structure.$put({
      param: { id: formId },
      json: { structure, changeLog },
    }),
  );
}

export const useFormLogicManagement = (formId: string) => {
  const queryClient = useQueryClient();
  const mutexRef = useRef<Promise<unknown>>(Promise.resolve());

  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = mutexRef.current.then(fn, fn);
    mutexRef.current = next;
    return next;
  };

  const structureQuery = useQuery({
    queryKey: ["formStructure", formId],
    queryFn: () => fetchStructure(formId),
    enabled: !!formId,
  });

  const rules = structureQuery.data?.structure.logic ?? [];

  const freshFetch = () =>
    queryClient.fetchQuery({
      queryKey: ["formStructure", formId],
      queryFn: () => fetchStructure(formId),
      staleTime: 0,
    });

  const createRule = useMutation({
    mutationFn: (rule: Omit<LogicRuleEntry, "id">) =>
      serialized(async () => {
        const current = await freshFetch();
        const existingRules = current.structure.logic ?? [];
        const newRule = {
          ...rule,
          id: crypto.randomUUID(),
        };
        const updatedStructure = {
          ...current.structure,
          logic: [...existingRules, newRule],
        };
        await saveStructure(formId, updatedStructure, "Add logic rule");
        return newRule;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formStructure", formId] });
    },
  });

  const updateRule = useMutation({
    mutationFn: ({
      ruleId,
      id: _id,
      ...data
    }: Partial<LogicRuleEntry> & { ruleId: string }) =>
      serialized(async () => {
        const current = await freshFetch();
        const existingRules = current.structure.logic ?? [];
        if (!existingRules.some((r) => r.id === ruleId)) {
          throw new Error(`Logic rule ${ruleId} not found`);
        }
        // id は ruleId で特定するため、data からの上書きを防ぐ
        const updatedRules = existingRules.map((r) =>
          r.id === ruleId ? { ...r, ...data, id: ruleId } : r,
        );
        const updatedStructure = {
          ...current.structure,
          logic: updatedRules,
        };
        await saveStructure(formId, updatedStructure, "Update logic rule");
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formStructure", formId] });
    },
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) =>
      serialized(async () => {
        const current = await freshFetch();
        const existingRules = current.structure.logic ?? [];
        const updatedStructure = {
          ...current.structure,
          logic: existingRules.filter((r) => r.id !== ruleId),
        };
        await saveStructure(formId, updatedStructure, "Delete logic rule");
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["formStructure", formId] });
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
