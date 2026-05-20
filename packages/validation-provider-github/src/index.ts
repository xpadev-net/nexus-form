export { GitHubApiClient, getGitHubClient } from "./client";
export {
  GITHUB_CONFIG_DEFAULTS,
  type GitHubServiceConfig,
  getGitHubApiTimeoutMs,
  getGitHubConfig,
  validateGitHubConfig,
} from "./config";
export { GitHubErrorCode } from "./error-codes";
export { default, githubProvider } from "./plugin";
export {
  GitHubProviderError,
  getGitHubErrorCode,
  getGitHubRateLimitRetryAfter,
  isGitHubAuthError,
  isGitHubProviderError,
  isGitHubRateLimitError,
  isGitHubUserNotFoundError,
  type OctokitRequestError,
  parseGitHubError,
} from "./utils";
