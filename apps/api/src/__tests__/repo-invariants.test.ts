import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("repo invariants", () => {
  it("keeps a root .dockerignore that excludes local env files", () => {
    const dockerignorePath = resolve(process.cwd(), "../../.dockerignore");
    const contents = readFileSync(dockerignorePath, "utf8");
    expect(contents).toContain(".env*");
    expect(contents).toContain("node_modules");
  });

  it("serves the web image with nginx unprivileged on port 8080", () => {
    const repoRoot = resolve(process.cwd(), "../..");
    const dockerfile = readFileSync(
      resolve(repoRoot, "Dockerfile.web"),
      "utf8",
    );
    expect(dockerfile).toContain("nginxinc/nginx-unprivileged");
    expect(dockerfile).toContain("listen 8080");
    expect(dockerfile).toContain("USER nginx");
    expect(dockerfile).not.toMatch(/FROM nginx:alpine/);

    const webDeployment = readFileSync(
      resolve(repoRoot, "k8s/base/web-deployment.yaml"),
      "utf8",
    );
    const webService = readFileSync(
      resolve(repoRoot, "k8s/base/web-service.yaml"),
      "utf8",
    );
    expect(webDeployment).toContain("containerPort: 8080");
    expect(webDeployment).not.toContain("containerPort: 3000");
    expect(webDeployment).toContain("runAsNonRoot: true");
    expect(webDeployment).toContain("runAsUser: 101");
    expect(webDeployment).toContain("allowPrivilegeEscalation: false");
    expect(webService).toContain("targetPort: 8080");
    expect(webService).not.toContain("targetPort: 3000");
  });

  it("chowns the API runtime workspace to node before dropping privileges", () => {
    const dockerfile = readFileSync(
      resolve(process.cwd(), "../../Dockerfile"),
      "utf8",
    );
    const runnerSection = dockerfile.slice(
      dockerfile.indexOf("FROM base AS runner"),
    );
    const workspaceChown = /chown -R node:node \/app(\s|$)/m;
    expect(runnerSection).toMatch(workspaceChown);
    expect(runnerSection).toContain("USER node");
    expect(runnerSection.search(workspaceChown)).toBeLessThan(
      runnerSection.indexOf("USER node"),
    );
  });

  it("runs CI tests against MySQL and Redis with minimal job permissions", () => {
    const ciWorkflow = readFileSync(
      resolve(process.cwd(), "../../.github/workflows/ci.yml"),
      "utf8",
    );
    const workflowPermissions = ciWorkflow.slice(
      0,
      ciWorkflow.indexOf("jobs:"),
    );
    expect(workflowPermissions).toMatch(
      /^permissions:\n {2}contents: read\n$/m,
    );

    const testJob = ciWorkflow.slice(
      ciWorkflow.indexOf("  test:"),
      ciWorkflow.indexOf("  build:"),
    );
    expect(testJob).toMatch(/^\s+permissions:\n\s+contents: read\n/m);
    expect(testJob).toContain("image: mysql:8.0");
    expect(testJob).toContain("image: redis:7-alpine");
    expect(testJob).toContain("pnpm db:migrate");

    const buildJob = ciWorkflow.slice(ciWorkflow.indexOf("  build:"));
    expect(buildJob).toContain("VITE_API_URL:");
    expect(buildJob).not.toContain("AUTH_SECRET: ${{ secrets.AUTH_SECRET }}");
  });
});
