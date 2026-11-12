export const MAX_MONEY_CENTS = 99_999_999_999;
export const SAVINGS_BASIS_POINTS = 1_000;
export const MIN_INVESTMENT_BASIS_POINTS = 1_000;
export const MAX_INVESTMENT_BASIS_POINTS = 10_000 - SAVINGS_BASIS_POINTS;
export const MIN_RETURN = -100;
export const MAX_RETURN = 500;
export const MAX_YEARS = 100;

export function isMoney(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_MONEY_CENTS;
}

export function parseMoney(text) {
  const value = text.trim().replace(/^\$\s*/, "");
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) {
    return null;
  }
  const [dollars, fraction = ""] = value.replaceAll(",", "").split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  return isMoney(cents) ? cents : null;
}

export function isInvestmentRate(value) {
  return Number.isInteger(value) &&
    value >= MIN_INVESTMENT_BASIS_POINTS && value <= MAX_INVESTMENT_BASIS_POINTS;
}

export function parseInvestmentRate(text) {
  const value = text.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const basisPoints = Math.round(Number(value) * 100);
  return isInvestmentRate(basisPoints) ? basisPoints : null;
}

export function isAnnualReturn(value) {
  return Number.isFinite(value) && value >= MIN_RETURN && value <= MAX_RETURN;
}

export function isHorizon(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_YEARS;
}

export function compoundProjection({ principal, contribution, rate, years }) {
  const initial = principal / 100;
  const payment = contribution / 100;
  const monthlyRate = rate / 1200;
  const logGrowth = Math.log1p(monthlyRate);
  const months = years * 12;
  const intervals = Math.min(months, 80);
  const points = [];

  for (let index = 0; index <= intervals; index++) {
    const month = Math.round(index / intervals * months);
    const contributions = initial + payment * month;
    let balance = contributions;
    if (monthlyRate !== 0) {
      const growth = Math.expm1(month * logGrowth);
      balance = initial * (1 + growth) + payment * (growth / monthlyRate);
    }
    points.push({ year: month / 12, contributions, balance });
  }

  const { balance, contributions } = points[points.length - 1];
  return { balance, contributions, change: balance - contributions, points };
}

export function paycheckSplit(income, expenses, investmentRate) {
  const savings = Math.round(income * SAVINGS_BASIS_POINTS / 10_000);
  // Keep cent rounding from allocating more than 100% before expenses.
  const investment = Math.min(income - savings, Math.round(income * investmentRate / 10_000));
  const remainder = income - savings - investment - expenses;
  return {
    savings,
    investment,
    emergency: Math.max(0, remainder),
    shortfall: Math.max(0, -remainder)
  };
}
