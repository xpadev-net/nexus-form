/**
 * Minimal FormStructure type for this validator.
 * Mirrors the structure from src/types/domain/form.
 */
interface FormStructure {
  version: number;
  settings: {
    privacy_notice?: string;
    [key: string]: unknown;
  };
  logic?: unknown[];
  confirmation?: unknown;
  notifications?: {
    on_submit?: {
      email?: { enabled: boolean; recipients?: string[] };
      discord?: { enabled: boolean; webhook_url?: string };
      webhook?: { enabled: boolean; url?: string };
    };
  };
  appearance?: unknown;
  access_control?: {
    password_protection?: { enabled: boolean; password_hint?: string };
    allowed_domains?: string[];
    allowed_roles?: string[];
  };
}

interface ValidationConfig {
  maxPrivacyNoticeLength: number;
  [key: string]: unknown;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  maxPrivacyNoticeLength: 10000,
};

/**
 * フォーム構造の詳細バリデーション
 */
export function validateFormStructureDetailed(
  structure: FormStructure,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // 1. 基本構造の検証
    const basicValidation = validateBasicStructure(structure, config);
    if (!basicValidation.isValid) {
      errors.push(...basicValidation.errors);
    }
    if (basicValidation.warnings) {
      warnings.push(...basicValidation.warnings);
    }

    // 2. 質問の検証は廃止（FormBlock APIで管理）

    // 3. 設定の検証
    if (structure.settings) {
      const settingsValidation = validateSettings(structure.settings, config);
      if (!settingsValidation.isValid) {
        errors.push(...settingsValidation.errors);
      }
      if (settingsValidation.warnings) {
        warnings.push(...settingsValidation.warnings);
      }
    }

    // 4. セクションの検証は廃止（section_separatorでページ分割を管理）

    // 5. ロジックルールの検証（FormBlock APIから質問情報を取得する必要がある）
    if (structure.logic) {
      // ロジックルール検証には FormBlock API から質問情報を取得して
      // 条件式のフィールド参照を解決する必要がある
      warnings.push(
        "Logic rules validation requires FormBlock API integration",
      );
    }

    // 6. 通知設定の検証
    if (structure.notifications) {
      const notificationValidation = validateNotifications(
        structure.notifications,
        config,
      );
      if (!notificationValidation.isValid) {
        errors.push(...notificationValidation.errors);
      }
      if (notificationValidation.warnings) {
        warnings.push(...notificationValidation.warnings);
      }
    }

    // 7. アクセス制御の検証
    if (structure.access_control) {
      const accessControlValidation = validateAccessControl(
        structure.access_control,
        config,
      );
      if (!accessControlValidation.isValid) {
        errors.push(...accessControlValidation.errors);
      }
      if (accessControlValidation.warnings) {
        warnings.push(...accessControlValidation.warnings);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [
        `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
      ],
      warnings: [],
    };
  }
}

/**
 * 基本構造の検証
 */
function validateBasicStructure(
  structure: FormStructure,
  _config: ValidationConfig,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // バージョン形式の検証
  if (typeof structure.version !== "number") {
    errors.push("Invalid version format. Expected format: number");
  }

  // 質問の検証は廃止（FormBlock APIで管理）

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 設定の検証
 */
function validateSettings(
  settings: FormStructure["settings"],
  config: ValidationConfig,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // プライバシー通知の長さ制限
  if (
    settings.privacy_notice &&
    settings.privacy_notice.length > config.maxPrivacyNoticeLength
  ) {
    errors.push(
      `Privacy notice too long: maximum ${config.maxPrivacyNoticeLength} characters allowed`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 通知設定の検証
 */
function validateNotifications(
  notifications: FormStructure["notifications"],
  _config: ValidationConfig,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!notifications) return { isValid: true, errors, warnings };

  // メール通知の検証
  if (notifications.on_submit?.email) {
    const { enabled, recipients } = notifications.on_submit.email;
    if (enabled && (!recipients || recipients.length === 0)) {
      errors.push("Email notifications enabled but no recipients specified");
    }
    if (recipients && recipients.length > 20) {
      errors.push("Too many email recipients: maximum 20 allowed");
    }
  }

  // Discord通知の検証
  if (notifications.on_submit?.discord) {
    const { enabled, webhook_url } = notifications.on_submit.discord;
    if (enabled && !webhook_url) {
      errors.push("Discord notifications enabled but no webhook URL specified");
    }
    if (webhook_url && !webhook_url.includes("discord.com")) {
      errors.push("Invalid Discord webhook URL");
    }
  }

  // Webhook通知の検証
  if (notifications.on_submit?.webhook) {
    const { enabled, url } = notifications.on_submit.webhook;
    if (enabled && !url) {
      errors.push("Webhook notifications enabled but no URL specified");
    }
    if (url && !url.startsWith("https://")) {
      errors.push("Webhook URL must use HTTPS");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * アクセス制御の検証
 */
function validateAccessControl(
  accessControl: FormStructure["access_control"],
  _config: ValidationConfig,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!accessControl) return { isValid: true, errors, warnings };

  // パスワード保護の検証
  if (accessControl.password_protection?.enabled) {
    if (!accessControl.password_protection.password_hint) {
      warnings.push("Password protection enabled but no hint provided");
    }
  }

  // 許可されたドメインの検証
  if (
    accessControl.allowed_domains &&
    accessControl.allowed_domains.length > 20
  ) {
    errors.push("Too many allowed domains: maximum 20 allowed");
  }

  // 許可されたロールの検証
  if (accessControl.allowed_roles && accessControl.allowed_roles.length > 20) {
    errors.push("Too many allowed roles: maximum 20 allowed");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * フォーム構造の整合性チェック（FormBlock API統合が必要）
 */
export function validateFormStructureIntegrity(
  structure: FormStructure,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 質問の検証は廃止（FormBlock APIで管理）
  warnings.push("Question validation requires FormBlock API integration");

  // ロジックルールの検証もFormBlock API統合が必要
  if (structure.logic) {
    warnings.push("Logic rules validation requires FormBlock API integration");
  }

  return {
    isValid: true,
    errors,
    warnings,
  };
}
