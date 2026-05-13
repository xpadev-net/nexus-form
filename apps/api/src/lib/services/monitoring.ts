/**
 * サービスモニタリング
 * 登録済みの ValidationProvider が公開する healthCheck() を順に呼び出し、
 * ヘルス / 統計 / アラートを集計する。サービス固有のエンドポイント情報は
 * 各プラグイン側に閉じ込められている。
 */

import { providerRegistry } from "@nexus-form/integrations";
import { logError, logInfo } from "../logger";

interface ServiceHealth {
  service: string;
  isHealthy: boolean;
  lastCheck: string;
  responseTime: number;
  errorCount: number;
  successRate: number;
}

interface ServiceAlert {
  id: string;
  service: string;
  type: "error" | "warning" | "info";
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  createdAt: string;
  isResolved: boolean;
  resolvedAt?: string;
}

interface ServiceStats {
  totalRequests: number;
  successCount: number;
  failCount: number;
  avgResponseTime: number;
}

class ServiceMonitor {
  private health = new Map<string, ServiceHealth>();
  private alerts: ServiceAlert[] = [];
  private stats = new Map<string, ServiceStats>();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private ensureBuckets(service: string): void {
    if (!this.health.has(service)) {
      this.health.set(service, {
        service,
        isHealthy: false,
        lastCheck: new Date().toISOString(),
        responseTime: 0,
        errorCount: 0,
        successRate: 0,
      });
    }
    if (!this.stats.has(service)) {
      this.stats.set(service, {
        totalRequests: 0,
        successCount: 0,
        failCount: 0,
        avgResponseTime: 0,
      });
    }
  }

  private monitorableProviders() {
    return providerRegistry
      .getAll()
      .filter((p) => typeof p.healthCheck === "function");
  }

  async checkHealth(service: string): Promise<boolean> {
    const provider = providerRegistry.get(service);
    if (!provider?.healthCheck) {
      throw new Error(
        `Provider "${service}" is not registered or has no healthCheck`,
      );
    }
    this.ensureBuckets(service);

    const start = Date.now();
    let isHealthy = false;
    try {
      isHealthy = await provider.healthCheck();
    } catch {
      isHealthy = false;
    }

    const responseTime = Date.now() - start;
    this.updateStats(service, isHealthy, responseTime);
    this.updateHealth(service, isHealthy, responseTime);

    if (!isHealthy) {
      this.addAlert(
        service,
        "error",
        `Service ${service} health check failed`,
        "high",
      );
    }

    return isHealthy;
  }

  async checkAllHealth(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    const providers = this.monitorableProviders();
    const promises = providers.map(async (provider) => {
      results[provider.name] = await this.checkHealth(provider.name);
    });
    await Promise.allSettled(promises);
    return results;
  }

  private updateStats(
    service: string,
    success: boolean,
    responseTime: number,
  ): void {
    const s = this.stats.get(service);
    if (!s) return;

    s.totalRequests++;
    if (success) {
      s.successCount++;
    } else {
      s.failCount++;
    }
    const totalTime = s.avgResponseTime * (s.totalRequests - 1) + responseTime;
    s.avgResponseTime = totalTime / s.totalRequests;
  }

  private updateHealth(
    service: string,
    isHealthy: boolean,
    responseTime: number,
  ): void {
    const h = this.health.get(service);
    if (!h) return;

    h.isHealthy = isHealthy;
    h.lastCheck = new Date().toISOString();
    h.responseTime = responseTime;
    if (!isHealthy) h.errorCount++;
    const s = this.stats.get(service);
    h.successRate =
      s && s.totalRequests > 0 ? s.successCount / s.totalRequests : 0;
  }

  private addAlert(
    service: string,
    type: "error" | "warning" | "info",
    message: string,
    severity: "low" | "medium" | "high" | "critical",
  ): void {
    const id = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    this.alerts.push({
      id,
      service,
      type,
      message,
      severity,
      createdAt: new Date().toISOString(),
      isResolved: false,
    });

    if (this.alerts.length > 500) {
      this.alerts = this.alerts.slice(-500);
    }
  }

  getHealth(): ServiceHealth[] {
    for (const provider of this.monitorableProviders()) {
      this.ensureBuckets(provider.name);
    }
    return Array.from(this.health.values());
  }

  getAlerts(includeResolved = false): ServiceAlert[] {
    if (includeResolved) return [...this.alerts];
    return this.alerts.filter((a) => !a.isResolved);
  }

  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.isResolved = true;
      alert.resolvedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  startPeriodicCheck(intervalMs = 60000): void {
    if (this.intervalId) return;

    logInfo("Starting service monitoring", "monitoring", {
      interval: intervalMs,
    });

    this.intervalId = setInterval(() => {
      this.checkAllHealth().catch((err) =>
        logError("Periodic health check failed", "monitoring", { error: err }),
      );
    }, intervalMs);
  }

  stopPeriodicCheck(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const serviceMonitor = new ServiceMonitor();
