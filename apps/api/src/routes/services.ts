import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import { systemSetting } from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import {
  type DynamicServiceEntry,
  parseStoredSystemSettingRow,
  parseSystemSettingValue,
  SYSTEM_SETTING_KEY,
  validateDynamicServicesMutationWrite,
  validateSystemSettingWrite,
} from "@nexus-form/shared";
import { eq, like } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getRedisClient } from "../lib/cache/redis-client";
import { deleteRedisKeysByPattern } from "../lib/cache/redis-key-cleanup";
import { withDualAuth } from "../lib/dual-auth";
import { getCacheStats } from "../lib/forms/response-counter";
import { createHonoApp } from "../lib/hono";
import { serviceMonitor } from "../lib/services/monitoring";
import {
  CacheClearResponseSchema,
  CacheStatsResponseSchema,
  DynamicServiceResponseSchema,
  DynamicServicesResponseSchema,
  MonitoringAlertsResponseSchema,
  MonitoringCheckResponseSchema,
  MonitoringHealthResponseSchema,
  RedisStatsResponseSchema,
  ServiceConfigResponseSchema,
  ServiceMessageResponseSchema,
  ServiceStatisticsResponseSchema,
  ServiceTestResponseSchema,
} from "../types/domain/services";

const serviceSchema = z
  .string()
  .min(1)
  .refine((value) => providerRegistry.has(value), {
    message: "Unknown validation provider",
  });

const updateServiceSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const cacheClearSchema = z.object({
  service: serviceSchema.optional(),
  force: z.boolean().optional(),
});

const DYNAMIC_KEY = SYSTEM_SETTING_KEY.SERVICES_DYNAMIC;
const CONFIG_KEY = SYSTEM_SETTING_KEY.SERVICES_CONFIG;

async function readSystemSettingRow(key: string): Promise<unknown | undefined> {
  const [row] = await db
    .select({ value: systemSetting.value })
    .from(systemSetting)
    .where(eq(systemSetting.key, key))
    .limit(1);
  return row?.value ?? undefined;
}

async function persistSystemSetting(
  key: typeof DYNAMIC_KEY | typeof CONFIG_KEY,
  value: DynamicServiceEntry[] | Record<string, unknown>,
  description: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: systemSetting.id })
    .from(systemSetting)
    .where(eq(systemSetting.key, key))
    .limit(1);

  if (existing) {
    await db
      .update(systemSetting)
      .set({ value, description })
      .where(eq(systemSetting.key, key));
    return;
  }

  await db.insert(systemSetting).values({
    id: randomUUID(),
    key,
    value,
    description,
  });
}

async function getDynamicServices(): Promise<DynamicServiceEntry[]> {
  const value = await readSystemSettingRow(DYNAMIC_KEY);
  return parseSystemSettingValue(DYNAMIC_KEY, value, []);
}

async function setDynamicServices(
  services: DynamicServiceEntry[],
): Promise<void> {
  let validated = validateSystemSettingWrite(DYNAMIC_KEY, services);

  if (!validated.success) {
    const existingCount = (await getDynamicServices()).length;
    validated = validateDynamicServicesMutationWrite(services, existingCount);
  }

  if (!validated.success) {
    throw new HTTPException(validated.status, { message: validated.error });
  }

  await persistSystemSetting(
    DYNAMIC_KEY,
    validated.value,
    "Dynamic external services",
  );
}

export const servicesRouter = createHonoApp()
  .use("/*", withDualAuth(["admin"]))
  .get("/dynamic", async (c) => {
    const services = await getDynamicServices();
    return c.json(
      DynamicServicesResponseSchema.parse({ success: true, data: services }),
    );
  })
  .get("/dynamic/:service", async (c) => {
    const parsed = serviceSchema.safeParse(c.req.param("service"));
    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid service type" }, 400);
    }
    const services = await getDynamicServices();
    const found = services.find((entry) => entry.service === parsed.data);
    if (!found)
      return c.json({ success: false, error: "Service not found" }, 404);
    return c.json(
      DynamicServiceResponseSchema.parse({ success: true, data: found }),
    );
  })
  .post(
    "/dynamic/:service/enable",
    zValidator("json", updateServiceSchema.optional()),
    async (c) => {
      const parsed = serviceSchema.safeParse(c.req.param("service"));
      if (!parsed.success) {
        return c.json({ success: false, error: "Invalid service type" }, 400);
      }
      const payload = c.req.valid("json");
      const services = await getDynamicServices();
      const index = services.findIndex(
        (entry) => entry.service === parsed.data,
      );
      const now = new Date().toISOString();

      if (index >= 0) {
        const current = services[index];
        if (!current)
          return c.json({ success: false, error: "Service not found" }, 404);
        services[index] = {
          ...current,
          enabled: true,
          config: payload?.config ?? current.config,
          metadata: payload?.metadata ?? current.metadata,
          updatedAt: now,
        };
      } else {
        services.push({
          service: parsed.data,
          enabled: true,
          config: payload?.config,
          metadata: payload?.metadata,
          updatedAt: now,
        });
      }

      await setDynamicServices(services);
      return c.json(
        ServiceMessageResponseSchema.parse({
          success: true,
          message: `Service ${parsed.data} enabled successfully`,
        }),
      );
    },
  )
  .post(
    "/dynamic/:service/disable",
    zValidator("json", updateServiceSchema.optional()),
    async (c) => {
      const parsed = serviceSchema.safeParse(c.req.param("service"));
      if (!parsed.success) {
        return c.json({ success: false, error: "Invalid service type" }, 400);
      }

      const payload = c.req.valid("json");
      const services = await getDynamicServices();
      const index = services.findIndex(
        (entry) => entry.service === parsed.data,
      );
      if (index < 0)
        return c.json({ success: false, error: "Service not found" }, 404);

      const current = services[index];
      if (!current)
        return c.json({ success: false, error: "Service not found" }, 404);
      services[index] = {
        ...current,
        enabled: false,
        config: payload?.config ?? current.config,
        metadata: payload?.metadata ?? current.metadata,
        updatedAt: new Date().toISOString(),
      };
      await setDynamicServices(services);

      return c.json(
        ServiceMessageResponseSchema.parse({
          success: true,
          message: `Service ${parsed.data} disabled successfully`,
        }),
      );
    },
  )
  .post(
    "/dynamic/:service/test",
    zValidator("json", updateServiceSchema.optional()),
    async (c) => {
      const parsed = serviceSchema.safeParse(c.req.param("service"));
      if (!parsed.success) {
        return c.json({ success: false, error: "Invalid service type" }, 400);
      }
      const services = await getDynamicServices();
      const found = services.find((entry) => entry.service === parsed.data);
      if (!found)
        return c.json({ success: false, error: "Service not found" }, 404);

      return c.json(
        ServiceTestResponseSchema.parse({
          success: true,
          data: {
            service: parsed.data,
            isValid: true,
            enabled: found.enabled,
            testedAt: new Date().toISOString(),
          },
        }),
      );
    },
  )
  .get("/cache", async (c) => {
    const stats = await getCacheStats();
    return c.json(
      CacheStatsResponseSchema.parse({ success: true, data: stats }),
    );
  })
  .get("/cache/stats", async (c) => {
    const redis = getRedisClient();
    if (!redis) {
      return c.json(
        RedisStatsResponseSchema.parse({
          success: true,
          data: {
            redisAvailable: false,
            message: "Redis is not configured",
          },
        }),
      );
    }

    const [ping, info] = await Promise.all([redis.ping(), redis.info()]);
    const keyspace = info
      .split("\n")
      .filter((line) => line.startsWith("db"))
      .map((line) => line.trim());

    return c.json(
      RedisStatsResponseSchema.parse({
        success: true,
        data: {
          redisAvailable: true,
          ping,
          keyspace,
        },
      }),
    );
  })
  .post("/cache/clear", zValidator("json", cacheClearSchema), async (c) => {
    const payload = c.req.valid("json");
    const redis = getRedisClient();
    if (!redis) {
      return c.json({ success: false, error: "Redis is not configured" }, 503);
    }

    if (payload.service) {
      const deleted = await deleteRedisKeysByPattern(
        redis,
        `service:cache:${payload.service}:*`,
      );
      return c.json(
        CacheClearResponseSchema.parse({
          success: true,
          data: { cleared: true, service: payload.service, deleted },
        }),
      );
    }

    if (!payload.force) {
      return c.json(
        { success: false, error: "force=true is required to clear all cache" },
        400,
      );
    }

    const deleted = await deleteRedisKeysByPattern(redis, "service:cache:*");
    return c.json(
      CacheClearResponseSchema.parse({
        success: true,
        data: { cleared: true, allServices: true, deleted },
      }),
    );
  })
  .get("/statistics", async (c) => {
    const services = await getDynamicServices();
    const cache = await getCacheStats();
    const enabledCount = services.filter((entry) => entry.enabled).length;

    return c.json(
      ServiceStatisticsResponseSchema.parse({
        success: true,
        data: {
          totalServices: services.length,
          enabledServices: enabledCount,
          disabledServices: services.length - enabledCount,
          cache,
        },
      }),
    );
  })
  .get("/config", async (c) => {
    const [configValue, dynamicSettings] = await Promise.all([
      readSystemSettingRow(CONFIG_KEY),
      db
        .select({ key: systemSetting.key, value: systemSetting.value })
        .from(systemSetting)
        .where(like(systemSetting.key, "services.%")),
    ]);
    const config = parseSystemSettingValue(CONFIG_KEY, configValue, {});

    const dynamic = dynamicSettings.flatMap((row) => {
      if (row.key === CONFIG_KEY) {
        return [];
      }
      const parsed = parseStoredSystemSettingRow(row.key, row.value);
      if (!parsed.success) {
        console.warn(`Skipping invalid system setting row: ${row.key}`);
        return [];
      }
      return [{ key: parsed.key, value: parsed.value }];
    });

    return c.json(
      ServiceConfigResponseSchema.parse({
        success: true,
        data: {
          config,
          dynamic,
        },
      }),
    );
  })
  .get("/monitoring/health", async (c) => {
    const health = serviceMonitor.getHealth();
    return c.json(
      MonitoringHealthResponseSchema.parse({ success: true, data: health }),
    );
  })
  .post("/monitoring/check", async (c) => {
    const results = await serviceMonitor.checkAllHealth();
    return c.json(
      MonitoringCheckResponseSchema.parse({ success: true, data: results }),
    );
  })
  .get("/monitoring/alerts", async (c) => {
    const alerts = serviceMonitor.getAlerts();
    return c.json(
      MonitoringAlertsResponseSchema.parse({ success: true, data: alerts }),
    );
  })
  .post("/monitoring/alerts/:alertId/resolve", async (c) => {
    const alertId = c.req.param("alertId");
    const resolved = serviceMonitor.resolveAlert(alertId);
    if (!resolved) {
      return c.json({ success: false, error: "Alert not found" }, 404);
    }
    return c.json(
      ServiceMessageResponseSchema.parse({
        success: true,
        message: "Alert resolved",
      }),
    );
  });
