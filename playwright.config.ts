import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL || "http://localhost:3000";
const skipWebServer =
  process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "1" ||
  process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "true";

const isLocalWebServerURL = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) &&
      url.port === "3000"
    );
  } catch {
    return false;
  }
};

const shouldStartWebServer = !skipWebServer && isLocalWebServerURL(baseURL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: shouldStartWebServer
    ? {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      }
    : undefined,
});
