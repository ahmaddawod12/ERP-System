export const DISPLAY_LOCALE = "en-IL";
export const DISPLAY_TIME_ZONE = "Asia/Jerusalem";

type DateValue = Date | string | number;

const dateFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  dateStyle: "medium",
  timeZone: DISPLAY_TIME_ZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DISPLAY_TIME_ZONE,
});

const numberFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  maximumFractionDigits: 3,
});

const currencyFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 2,
});

export function formatDate(value: DateValue): string {
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: DateValue): string {
  return dateTimeFormatter.format(new Date(value));
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}
