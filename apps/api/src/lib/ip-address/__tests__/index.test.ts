import { describe, expect, it } from "vitest";
import { extractClientIP } from "../index";

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
    it("should extract IP from x-forwarded-for header", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "192.168.1.1, 10.0.0.1",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("192.168.1.1");
      expect(result.source).toBe("x-forwarded-for");
    });

    it("should return unknown when no headers present", () => {
      const request = new Request("http://localhost");

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("unknown");
      expect(result.source).toBe("unknown");
    });

    it("should prioritize x-forwarded-for over x-real-ip", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "192.168.1.1",
          "x-real-ip": "10.0.0.1",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("192.168.1.1");
      expect(result.source).toBe("x-forwarded-for");
    });

    it("should fallback to x-real-ip when x-forwarded-for is not present", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-real-ip": "10.0.0.1",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("10.0.0.1");
      expect(result.source).toBe("x-real-ip");
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

    it("should trim whitespace from IP", () => {
      const request = new Request("http://localhost", {
        headers: {
          "x-forwarded-for": "  192.168.1.1  ",
        },
      });

      const result = extractClientIP(request, { strategy: "general" });
      expect(result.ip).toBe("192.168.1.1");
    });
  });
});
