import { dynamicServiceEntrySchema } from "@nexus-form/shared";
import { z } from "zod";

/** 動的に登録された外部サービスのエントリ。 */
export const DynamicServiceEntrySchema = dynamicServiceEntrySchema;

/** `{ success: true, message }` 形式のレスポンス。 */
export const ServiceMessageResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});
export type ServiceMessageResponse = z.infer<
  typeof ServiceMessageResponseSchema
>;

/** GET /services/dynamic のレスポンス。 */
export const DynamicServicesResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(DynamicServiceEntrySchema),
});
export type DynamicServicesResponse = z.infer<
  typeof DynamicServicesResponseSchema
>;

/** GET /services/dynamic/:service のレスポンス。 */
export const DynamicServiceResponseSchema = z.object({
  success: z.literal(true),
  data: DynamicServiceEntrySchema,
});
export type DynamicServiceResponse = z.infer<
  typeof DynamicServiceResponseSchema
>;

/** POST /services/dynamic/:service/test のレスポンス。 */
export const ServiceTestResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    service: z.string(),
    isValid: z.boolean(),
    enabled: z.boolean(),
    testedAt: z.string(),
  }),
});
export type ServiceTestResponse = z.infer<typeof ServiceTestResponseSchema>;

/** GET /services/cache のレスポンス。 */
export const CacheStatsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    redisAvailable: z.boolean(),
    cachedFormCount: z.number().int(),
  }),
});
export type CacheStatsResponse = z.infer<typeof CacheStatsResponseSchema>;

/** GET /services/cache/stats のレスポンス（Redis 有無で形が変わる）。 */
export const RedisStatsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    redisAvailable: z.boolean(),
    message: z.string().optional(),
    ping: z.string().optional(),
    keyspace: z.array(z.string()).optional(),
  }),
});
export type RedisStatsResponse = z.infer<typeof RedisStatsResponseSchema>;

/** POST /services/cache/clear のレスポンス。 */
export const CacheClearResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    cleared: z.literal(true),
    service: z.string().optional(),
    deleted: z.number().int().optional(),
    allServices: z.boolean().optional(),
  }),
});
export type CacheClearResponse = z.infer<typeof CacheClearResponseSchema>;

/** GET /services/statistics のレスポンス。 */
export const ServiceStatisticsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    totalServices: z.number().int(),
    enabledServices: z.number().int(),
    disabledServices: z.number().int(),
    cache: z.object({
      redisAvailable: z.boolean(),
      cachedFormCount: z.number().int(),
    }),
  }),
});
export type ServiceStatisticsResponse = z.infer<
  typeof ServiceStatisticsResponseSchema
>;

/** GET /services/config のレスポンス。 */
export const ServiceConfigResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    config: z.record(z.string(), z.unknown()),
    dynamic: z.array(
      z.object({
        key: z.string(),
        value: z.unknown(),
      }),
    ),
  }),
});
export type ServiceConfigResponse = z.infer<typeof ServiceConfigResponseSchema>;

/** サービスのヘルス状態。 */
export const ServiceHealthSchema = z.object({
  service: z.string(),
  isHealthy: z.boolean(),
  lastCheck: z.string(),
  responseTime: z.number(),
  errorCount: z.number().int(),
  successRate: z.number(),
});

/** GET /services/monitoring/health のレスポンス。 */
export const MonitoringHealthResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(ServiceHealthSchema),
});
export type MonitoringHealthResponse = z.infer<
  typeof MonitoringHealthResponseSchema
>;

/** POST /services/monitoring/check のレスポンス。 */
export const MonitoringCheckResponseSchema = z.object({
  success: z.literal(true),
  data: z.record(z.string(), z.boolean()),
});
export type MonitoringCheckResponse = z.infer<
  typeof MonitoringCheckResponseSchema
>;

/** サービスのアラート。 */
export const ServiceAlertSchema = z.object({
  id: z.string(),
  service: z.string(),
  type: z.enum(["error", "warning", "info"]),
  message: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  createdAt: z.string(),
  isResolved: z.boolean(),
  resolvedAt: z.string().optional(),
});

/** GET /services/monitoring/alerts のレスポンス。 */
export const MonitoringAlertsResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(ServiceAlertSchema),
});
export type MonitoringAlertsResponse = z.infer<
  typeof MonitoringAlertsResponseSchema
>;
