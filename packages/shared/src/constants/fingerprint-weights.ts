/**
 * フィンガープリントコンポーネント重み付け定数
 *
 * 168件のランダム回答者データのユニーク値比率分析に基づく。
 * 各コンポーネントの重みは、そのコンポーネントが個人を識別する能力に比例する。
 */
export const COMPONENT_WEIGHTS: Record<string, number> = {
  // 高い個人の識別力
  canvas: 1.2,
  fonts: 1.0,
  webgl: 0.8,
  audio: 0.8,
  webrtc: 0.6,
  screenFrame: 0.4,

  // 低引き下げ: 共通性が高く識別力が低いノイズ項目
  system: 0.15,
  speech: 0.1,
  screen: 0.2,
  screenResolution: 0.15,
  hardwareConcurrency: 0.1,
  hardware: 0.1,
  deviceMemory: 0.1,
  plugins: 0.05,
  locales: 0.05,
  languages: 0.05,
  vendorFlavors: 0.05,
  platform: 0.05,
  userAgent: 0.05,
  language: 0.05,

  // 極めて低い識別力 (1-3%)
  dateTimeLocale: 0.03,
  timezone: 0.03,
  colorDepth: 0.03,
  domBlockers: 0.03,
  reducedTransparency: 0.03,
  vendor: 0.03,

  // ほぼゼロの識別力
  applePay: 0.02,
  architecture: 0.02,
  colorGamut: 0.02,
  contrast: 0.02,
  hdr: 0.02,
  invertedColors: 0.02,
  math: 0.02,
  osCpu: 0.02,
  pdfViewerEnabled: 0.02,
  privateClickMeasurement: 0.02,
  reducedMotion: 0.02,

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
