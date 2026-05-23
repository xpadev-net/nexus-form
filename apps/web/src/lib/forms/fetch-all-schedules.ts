import { client, rpc } from "@/lib/api";

const SCHEDULE_PAGE_SIZE = 100;

async function fetchSchedulePage(
  formId: string,
  page: number,
  signal?: AbortSignal,
) {
  return rpc(
    client.api.forms[":id"].schedule.$get(
      {
        param: { id: formId },
        query: { page: String(page), pageSize: String(SCHEDULE_PAGE_SIZE) },
      },
      { init: { signal } },
    ),
  );
}

export type ScheduleEntry = Awaited<
  ReturnType<typeof fetchSchedulePage>
>["schedules"][number];

export async function fetchAllSchedules(
  formId: string,
  signal?: AbortSignal,
): Promise<{
  schedules: ScheduleEntry[];
}> {
  const schedules: ScheduleEntry[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const res = await fetchSchedulePage(formId, page, signal);
    schedules.push(...res.schedules);
    totalPages = res.pagination.totalPages;
    page++;
  } while (page <= totalPages);

  return { schedules };
}
