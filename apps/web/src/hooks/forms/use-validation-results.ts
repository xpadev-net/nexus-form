import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { client, rpc } from "@/lib/api";

export type ValidationResultsFilter = {
  status?: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "MISSING";
  serviceName?: string;
  success?: boolean;
};

export const useValidationResults = (
  formId: string | null | undefined,
  responseId: string | null | undefined,
  filter?: ValidationResultsFilter,
) => {
  const queryClient = useQueryClient();

  const validationResultsQuery = useQuery({
    queryKey: ["validationResults", formId, responseId],
    queryFn:
      formId && responseId
        ? () =>
            rpc(
              client.api.forms[":id"].responses[":responseId"].$get({
                param: { id: formId, responseId },
              }),
            )
        : skipToken,
  });

  const validations = useMemo(() => {
    const items = validationResultsQuery.data?.externalValidations ?? [];
    if (!filter) {
      return items;
    }

    return items.filter((item) => {
      if (filter.status && item.status !== filter.status) return false;
      if (filter.serviceName && item.service !== filter.serviceName)
        return false;
      if (filter.success !== undefined && item.success !== filter.success)
        return false;
      return true;
    });
  }, [filter, validationResultsQuery.data?.externalValidations]);

  const retryResponseValidationMutation = useMutation({
    mutationFn: () => {
      if (!formId || !responseId)
        throw new Error("formId and responseId are required");
      return rpc(
        client.api.forms[":id"].responses[":responseId"].validation.retry.$post(
          {
            param: { id: formId, responseId },
          },
        ),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["validationResults", formId, responseId],
      });
    },
  });

  const bulkRetryMutation = useMutation({
    mutationFn: (validationResultIds: string[]) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"].responses.validation["bulk-retry"].$post({
          param: { id: formId },
          json: { validationResultIds },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["validationResults", formId, responseId],
      });
    },
  });

  const cancelValidationMutation = useMutation({
    mutationFn: (validationResultId: string) => {
      if (!formId || !responseId)
        throw new Error("formId and responseId are required");
      return rpc(
        client.api.forms[":id"].responses[":responseId"].validation[
          ":validationResultId"
        ].cancel.$post({
          param: { id: formId, responseId, validationResultId },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["validationResults", formId, responseId],
      });
    },
  });

  return {
    validationResultsQuery,
    validations,
    retryResponseValidationMutation,
    bulkRetryMutation,
    cancelValidationMutation,
  };
};
