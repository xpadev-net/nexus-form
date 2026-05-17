const formStructureMutationQueues = new Map<string, Promise<unknown>>();

// This is an in-process guard for short critical sections in one API worker.
// Multi-instance deployments must replace or augment it with DB/Redis locking.
export async function withFormStructureMutationLock<T>(
  formId: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const previous = formStructureMutationQueues.get(formId) ?? Promise.resolve();

  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  formStructureMutationQueues.set(formId, queued);

  await previous.catch(() => undefined);

  try {
    return await mutation();
  } finally {
    release();
    if (formStructureMutationQueues.get(formId) === queued) {
      formStructureMutationQueues.delete(formId);
    }
  }
}
