export const apiRequestInit = (init: RequestInit = {}): RequestInit => ({
  ...init,
  credentials: "include",
});
