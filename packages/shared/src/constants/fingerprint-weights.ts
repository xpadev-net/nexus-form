/**
 * フィンガープリントコンポーネント重み付け定数
 *
 * 実応募データ(83件・169件)の各コンポーネント値の分散分析に基づく。
 * 真に個人を識別できるHPシグナル(canvas/fonts/system/screen)を主軸に据え、
 * ハードウェア homogeneity で衝突多発する audio/webgl/webrtc の重みを引き下げている。
 *
 * また iPhone/Safari ユーザー間で必ず一致してしまう低識別力ノイズ項目
 * (applePay/architecture/vendor/timezone 等)は重み 0 に設定し、
 * matchedWeight がノイズの累積で不当に押し上げられないようにしている。
 * 多少の分散を持つ項目(hardware/languages/speech 等)のみ小重みを残し、
 * 同端末の同一人物識別にわずかに寄与させる。
 */
export const COMPONENT_WEIGHTS: Record<string, number> = {
  // === HP主軸(高識別シグナル) ===
  canvas: 1.2, // 33% top frequency — モデル間差分で個人識別力が最も高い
  fonts: 1.0, // 26% top — フォントリスト差分は個人単位で安定
  system: 0.5, // UA・OS文字列由来の安定シグナル
  screen: 0.4, // 解像度組合せで個人識別に寄与

  // === HP補助 ===
  hardwareConcurrency: 0.2, // 多少の分散あり
  screenResolution: 0.2,
  screenFrame: 0.25, // 39% top — iPhone系で衝突しやすい
  webrtc: 0.3, // 42% top — 候補IP透過性で揺らぐため控えめに

  // === HP退化系(過大評価防止のため大幅引き下げ) ===
  webgl: 0.25, // 47% top — iPhone GPU統合で衝突過多
  audio: 0.25, // 74% top — ほぼノイズ化しているがわずかに寄与

  // === 微細シグナル(≥3 distinct かつ top <85% の項目のみ残存) ===
  hardware: 0.03, // 14 distinct, 67% top
  deviceMemory: 0.03, // 5 distinct, 80% top
  audioBaseLatency: 0.03, // 7 distinct, 79% top
  platform: 0.03, // 5 distinct, 79% top
  userAgent: 0.05, // 文字列表現由来の差分
  userAgentData: 0.05,
  speech: 0.03, // 41 distinct, 43% top — やや識別力あり
  languages: 0.03, // 6 distinct, 64% top
  locales: 0.03, // 7 distinct, 66% top
  vendorFlavors: 0.03, // 6 distinct, 82% top
  dateTimeLocale: 0.02, // 4 distinct, 80% top
  colorDepth: 0.02, // 3 distinct, 57% top
  domBlockers: 0.02, // 3 distinct, 79% top
  reducedTransparency: 0.02, // 3 distinct, 71% top

  // === ゼロ識別力(<3 distinct または top >85%) ===
  // IP 系以外は全件同一または2値で分布偏りが極めて大きく、
  // iPhone/Safari ユーザー間で必ず一致してしまうため 0 とする。
  applePay: 0.0, // 2 distinct, 86% top
  architecture: 0.0, // 2 distinct, 79% top
  colorGamut: 0.0, // 2 distinct, 82% top
  contrast: 0.0, // 2 distinct, 99% top
  hdr: 0.0, // 2 distinct, 82% top
  invertedColors: 0.0, // 2 distinct, 86% top
  math: 0.0, // 2 distinct, 86% top
  osCpu: 0.0, // 2 distinct, 96% top
  pdfViewerEnabled: 0.0, // 2 distinct, 93% top
  privateClickMeasurement: 0.0, // 2 distinct, 86% top
  reducedMotion: 0.0, // 2 distinct, 91% top
  vendor: 0.0, // 3 distinct, 82% top
  timezone: 0.0, // 4 distinct, 80% top — 日本国内では実質1値
  plugins: 0.0, // 8 distinct, 89% top

  // === ゼロ識別力(全回答者で100%同一) ===
  cookiesEnabled: 0.0,
  cpuClass: 0.0,
  fontPreferences: 0.0,
  forcedColors: 0.0,
  language: 0.0,
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
export const DEFAULT_COMPONENT_WEIGHT = 0.02;
