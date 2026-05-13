import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FormActionButton } from "@/components/forms/form-action-button";
import {
  FormFilterBar,
  type FormFilterStatus,
} from "@/components/forms/form-filter-bar";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { useForms } from "@/hooks/forms/use-forms";

const normalizeFormStatus = (
  status: unknown,
): Exclude<FormFilterStatus, "all"> => {
  if (status === "PUBLISHED") {
    return "published";
  }
  if (status === "UNPUBLISHED") {
    return "unpublished";
  }
  if (status === "ARCHIVED") {
    return "archived";
  }
  return "draft";
};

export const FormList = () => {
  const navigate = useNavigate();
  const { formsQuery } = useForms();
  const [searchTerm, setSearchTerm] = useState("");
  const [status, setStatus] = useState<FormFilterStatus>("all");
  const forms = formsQuery.data?.forms ?? [];

  const filteredForms = useMemo(() => {
    return forms.filter((item) => {
      const currentStatus = normalizeFormStatus(item.status);
      const matchesStatus = status === "all" || currentStatus === status;
      const matchesSearch = item.title
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [forms, searchTerm, status]);

  if (formsQuery.isLoading) {
    return <div>Loading forms...</div>;
  }

  if (formsQuery.isError) {
    return <div>Failed to load forms</div>;
  }

  return (
    <>
      <FormFilterBar
        searchTerm={searchTerm}
        status={status}
        onSearchTermChange={setSearchTerm}
        onStatusChange={setStatus}
      />
      <ul className="space-y-2">
        {filteredForms.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-2 rounded border p-3"
          >
            <div className="space-y-1">
              <p>{item.title}</p>
              <FormStatusBadge
                status={
                  typeof item.status === "string" ? item.status : undefined
                }
              />
            </div>
            <FormActionButton
              onClick={() =>
                void navigate({
                  to: "/forms/$id/edit",
                  params: { id: item.id },
                })
              }
            >
              開く
            </FormActionButton>
          </li>
        ))}
      </ul>
    </>
  );
};
