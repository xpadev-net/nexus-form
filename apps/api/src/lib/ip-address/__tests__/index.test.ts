import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractClientIP } from "../index";

const originalTrustedProxyCount = process.env.TRUSTED_PROXY_COUNT;

beforeEach(() => {
  delete process.env.TRUSTED_PROXY_COUNT;
});

afterEach(() => {
  if (originalTrustedProxyCount === undefined) {
    delete process.env.TRUSTED_PROXY_COUNT;
  } else {
    process.env.TRUSTED_PROXY_COUNT = originalTrustedProxyCount;
  }
});

describe("extractClientIP", () => {
  describe("telemetry strategy", () => {
    it("should extract IP from x-nginx-forwarded-for header", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-nginx-forwarded-for": "192.168.1.1, 10.0.0.1",
        },
      });

      const result = extractClientIP(request, { strategy: "telemetry" });
      expect(result.ip).toBe("192.168.1.1");
      expect(result.source).toBe("x-nginx-forwarded-for");
    });

    it("should return unknown when no headers present", () => {
      const request = new Request("http://localhost");

      const result = extractClientIP(request, { strategy: "telemetry" });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should not use x-forwarded-for header", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "192.168.1.1",
          "x-nginx-forwarded-for": "10.0.0.1",
        },
      });

      const result = extractClientIP(request, { strategy: "telemetry" });
      expect(result.ip).toBe("10.0.0.1");
      expect(result.source).toBe("x-nginx-forwarded-for");
    });

    it("should trim whitespace from IP", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-nginx-forwarded-for": "  192.168.1.1  ",
        },
      });

      const result = extractClientIP(request, { strategy: "telemetry" });
      expect(result.ip).toBe("192.168.1.1");
    });
  });

  describe("general strategy", () => {
    it("should use socket IP when no trusted proxy is configured", () => {
      const request = {
        headers: new Headers({
          "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        }),
        remoteAddress: "198.51.100.10",
      };

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("198.51.100.10");
      expect(result.source).toBe("socket");
    });

    it("should ignore x-forwarded-for header when no trusted proxy is configured and socket IP is unavailable", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should extract IP from x-forwarded-for using trusted proxy count", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        },
      });

      const result = extractClientIP(request, {
        strategy: "general",
        trustedProxyCount: 2,
      });
      expect(result.ip).toBe("192.168.1.1");
      expect(result.source).toBe("x-forwarded-for");
    });

    it("should use TRUSTED_PROXY_COUNT when an option is not supplied", () => {
      process.env.TRUSTED_PROXY_COUNT = "2";
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("192.168.1.1");
      expect(result.source).toBe("x-forwarded-for");
    });

    it("should ignore malformed TRUSTED_PROXY_COUNT values", () => {
      process.env.TRUSTED_PROXY_COUNT = "1abc";
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "192.168.1.1",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should return unknown when no headers present", () => {
      const request = new Request("http://localhost");

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should prioritize trusted x-forwarded-for over x-real-ip", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "192.168.1.1",
          "x-real-ip": "10.0.0.1",
        },
      });

      const result = extractClientIP(request, {
        strategy: "general",
        trustedProxyCount: 1,
      });
      expect(result.ip).toBe("192.168.1.1");
      expect(result.source).toBe("x-forwarded-for");
    });

    it("should ignore x-real-ip when no trusted proxy is configured", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-real-ip": "10.0.0.1",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should ignore cf-connecting-ip when no trusted proxy is configured", () => {
      const request = new Request("http://localhost", {
        headers: {
          "cf-connecting-ip": "203.0.113.10",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should ignore x-real-ip even when a trusted proxy is configured", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-real-ip": "10.0.0.1",
        },
      });

      const result = extractClientIP(request, {
        strategy: "general",
        trustedProxyCount: 1,
      });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should ignore cf-connecting-ip even when a trusted proxy is configured", () => {
      const request = new Request("http://localhost", {
        headers: {
          "cf-connecting-ip": "203.0.113.10",
        },
      });

      const result = extractClientIP(request, {
        strategy: "general",
        trustedProxyCount: 1,
      });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should reject invalid forwarded IP values", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "not-an-ip, 10.0.0.1",
        },
      });

      const result = extractClientIP(request, {
        strategy: "general",
        trustedProxyCount: 2,
      });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should not use x-nginx-forwarded-for header", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-nginx-forwarded-for": "192.168.1.1",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should trim whitespace from trusted IP", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "  192.168.1.1  ",
        },
      });

      const result = extractClientIP(request, {
        strategy: "general",
        trustedProxyCount: 1,
      });
      expect(result.ip).toBe("192.168.1.1");
    });
  });
});
