declare module "speakeasy" {
  interface TotpOptions {
    secret: string;
    encoding?: string;
    digits?: number;
    step?: number;
    window?: number;
  }

  export function totp(options: TotpOptions): string;
}
