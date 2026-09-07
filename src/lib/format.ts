export const formatCurrency = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);

export const formatNumber = (value: number, max = 2) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: max,
  }).format(value);

export const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`;
