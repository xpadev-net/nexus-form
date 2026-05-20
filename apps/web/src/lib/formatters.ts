const japanDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const japanDateFormatter = new Intl.DateTimeFormat("ja-JP");

const japanShortDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const japanLocaleDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

export const formatJapanDateTime = (date: Date | string): string =>
  japanDateTimeFormatter.format(new Date(date));

export const formatJapanDate = (date: Date | string): string =>
  japanDateFormatter.format(new Date(date));

export const formatJapanShortDateTime = (date: Date | string): string =>
  japanShortDateTimeFormatter.format(new Date(date));

export const formatJapanLocaleDateTime = (date: Date | string): string =>
  japanLocaleDateTimeFormatter.format(new Date(date));
