export class AccountNotFoundError extends Error {
  constructor(
    public provider: string,
    public accountId: string,
    message?: string,
  ) {
    super(message ?? `Account not found for provider "${provider}".`);
    this.name = "AccountNotFoundError";
  }
}
