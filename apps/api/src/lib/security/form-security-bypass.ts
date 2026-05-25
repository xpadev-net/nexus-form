const developmentBypassFlags = [
  "FORM_SECURITY_DEV_BYPASS",
  "VITE_FORM_SECURITY_DEV_BYPASS",
  "DISABLE_HCAPTCHA",
  "VITE_DISABLE_HCAPTCHA",
] as const;

export function isFormSecurityBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    developmentBypassFlags.some((name) => process.env[name] === "true")
  );
}
