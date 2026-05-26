export function isFormSecurityBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.FORM_SECURITY_DEV_BYPASS === "true"
  );
}

export function isHCaptchaBypassEnabled(): boolean {
  return (
    isFormSecurityBypassEnabled() ||
    (process.env.NODE_ENV === "development" &&
      (process.env.DISABLE_HCAPTCHA === "true" ||
        process.env.VITE_DISABLE_HCAPTCHA === "true"))
  );
}
