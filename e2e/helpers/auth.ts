import type { BrowserContext, Page } from "@playwright/test";

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

export const TEST_USERS = {
  userA: {
    email: "user-a@example.com",
    password: "password123",
    name: "User A",
  },
  userB: {
    email: "user-b@example.com",
    password: "password123",
    name: "User B",
  },
} as const;

/**
 * baseURLを取得する
 */
export function getBaseURL(): string {
  return process.env.BASE_URL || "http://localhost:3000";
}

/**
 * ユーザーをログインさせる
 */
export async function loginUser(page: Page, user: TestUser): Promise<void> {
  await page.goto("/auth/signin");
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("/", { timeout: 10000 });
}

/**
 * 認証済みのコンテキストを作成する
 */
export async function createAuthenticatedContext(
  context: BrowserContext,
  user: TestUser,
): Promise<Page> {
  const page = await context.newPage();
  await loginUser(page, user);
  return page;
}
