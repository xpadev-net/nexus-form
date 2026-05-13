/**
 * Validation Provider Registry
 *
 * 登録済み検証プロバイダーの管理
 */

import type {
  ValidationProvider,
  ValidationProviderRule,
} from "./plugin-interface";

export class ValidationProviderRegistry {
  private providers = new Map<string, ValidationProvider>();

  register(provider: ValidationProvider): void {
    if (typeof provider.name !== "string" || provider.name.length > 64) {
      throw new Error(
        `Invalid provider name: ${provider.name}. Must be 64 characters or less`,
      );
    }

    if (!/^[a-z][a-z0-9_]*$/.test(provider.name)) {
      throw new Error(
        `Invalid provider name: ${provider.name}. Must start with letter and contain only a-z, 0-9, _`,
      );
    }

    if (this.providers.has(provider.name)) {
      throw new Error(`Provider ${provider.name} is already registered`);
    }

    this.providers.set(provider.name, provider);
  }

  get(name: string): ValidationProvider | undefined {
    return this.providers.get(name);
  }

  getRule(
    providerName: string,
    ruleType: string,
  ): ValidationProviderRule | undefined {
    const provider = this.providers.get(providerName);
    return provider?.rules[ruleType];
  }

  getAll(): ValidationProvider[] {
    return Array.from(this.providers.values());
  }

  getNames(): string[] {
    return Array.from(this.providers.keys());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  unregister(name: string): boolean {
    return this.providers.delete(name);
  }
}

export const providerRegistry = new ValidationProviderRegistry();
