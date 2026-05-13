/**
 * フィンガープリントコンポーネント重み付け定数
 *
 * 168件のランダム回答者データのユニーク値比率分析に基づく。
 * 各コンポーネントの重みは、そのコンポーネントが個人を識別する能力に比例する。
 */
export const COMPONENT_WEIGHTS: Record<string, number> = {
  // 複合ハッシュ (二重カウント防止のため中程度)
  v4: 0.3,
  v6: 0.3,

  // 高い識別力 (ユニーク値比率 20%以上)
  fonts: 1.0,
  system: 0.95,
  screen: 0.9,
  speech: 0.85,

  // 良好な識別力 (15-20%)
  canvas: 0.7,
  screenResolution: 0.65,
  screenFrame: 0.6,

  // 中程度の識別力 (5-15%)
  hardwareConcurrency: 0.5,
  hardware: 0.45,
  audio: 0.4,
  webrtc: 0.4,
  webgl: 0.35,

  // 低い識別力 (3-5%)
  plugins: 0.25,
  audioBaseLatency: 0.2,
  locales: 0.2,
  languages: 0.18,
  vendorFlavors: 0.18,
  deviceMemory: 0.15,
  platform: 0.15,
  userAgent: 0.15,
  language: 0.18,

  // 極めて低い識別力 (1-3%)
  dateTimeLocale: 0.1,
  timezone: 0.1,
  colorDepth: 0.08,
  domBlockers: 0.08,
  reducedTransparency: 0.08,
  vendor: 0.08,

  // ほぼゼロの識別力 (2値、80%以上同一)
  applePay: 0.03,
  architecture: 0.03,
  colorGamut: 0.03,
  contrast: 0.03,
  hdr: 0.03,
  invertedColors: 0.03,
  math: 0.03,
  osCpu: 0.03,
  pdfViewerEnabled: 0.03,
  privateClickMeasurement: 0.03,
  reducedMotion: 0.03,

  // ゼロの識別力 (全回答者で100%同一)
  cookiesEnabled: 0.0,
  cpuClass: 0.0,
  fontPreferences: 0.0,
  forcedColors: 0.0,
  indexedDB: 0.0,
  localStorage: 0.0,
  monochrome: 0.0,
  openDatabase: 0.0,
  sessionStorage: 0.0,
  touchSupport: 0.0,
  webGlBasics: 0.0,
  webGlExtensions: 0.0,
};

/** 未知のコンポーネントに適用するデフォルト重み */
export const DEFAULT_COMPONENT_WEIGHT = 0.05;
