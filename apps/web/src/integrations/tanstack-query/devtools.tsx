import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

export const QueryDevtools = () => {
  if (import.meta.env.PROD) return null;
  return <ReactQueryDevtools initialIsOpen={false} />;
};
