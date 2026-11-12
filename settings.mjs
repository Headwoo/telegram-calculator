import {
  isMoney, isInvestmentRate, isAnnualReturn, isHorizon, MIN_INVESTMENT_BASIS_POINTS
} from "./finance.mjs";

export const MAX_CATEGORIES = 100;
export const MAX_CATEGORY_NAME = 64;
export const CATEGORY_COLORS = ["blue", "teal", "violet", "amber", "pink"];
const icons = ["house", "basket", "car", "receipt", "coffee"];
const defaults = [
  { id: "housing", label: "Housing", color: "blue", icon: "house", initial: 165_000 },
  { id: "groceries", label: "Groceries", color: "teal", icon: "basket", initial: 56_000 },
  { id: "transport", label: "Transport", color: "violet", icon: "car", initial: 42_000 },
  { id: "bills", label: "Bills", color: "amber", icon: "receipt", initial: 37_000 },
  { id: "lifestyle", label: "Lifestyle", color: "pink", icon: "coffee", initial: 45_000 }
];

export function validCategoryName(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.trim().length <= MAX_CATEGORY_NAME && !/[\u0000-\u001f\u007f]/.test(value);
}

export function normalizeSettings(value = {}) {
  const saved = value && typeof value === "object" ? value : {};
  const seen = new Set();
  const categories = Array.isArray(saved.categories) ? saved.categories.slice(0, MAX_CATEGORIES).filter(category => {
    if (!category || typeof category.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(category.id) ||
      seen.has(category.id) || !validCategoryName(category.label)) return false;
    seen.add(category.id);
    return true;
  }).map((category, index) => ({
    id: category.id, label: category.label.trim(),
    color: CATEGORY_COLORS.includes(category.color) ? category.color : CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    icon: icons.includes(category.icon) ? category.icon : "receipt"
  })) : [];
  if (!categories.length) categories.push(...defaults.map(({ initial, ...category }) => ({ ...category })));
  return {
    theme: ["dark", "light"].includes(saved.theme) ? saved.theme : null,
    activeTab: ["growth", "budget", "split"].includes(saved.activeTab) ? saved.activeTab : "growth",
    income: isMoney(saved.income) ? saved.income : 520_000,
    investmentRate: isInvestmentRate(saved.investmentRate) ? saved.investmentRate : MIN_INVESTMENT_BASIS_POINTS,
    categories,
    expenses: Object.fromEntries(categories.map(({ id }) => [id,
      isMoney(saved.expenses?.[id]) ? saved.expenses[id] : defaults.find(category => category.id === id)?.initial ?? 0
    ])),
    projection: {
      principal: isMoney(saved.projection?.principal) ? saved.projection.principal : 1_000_000,
      contribution: isMoney(saved.projection?.contribution) ? saved.projection.contribution : 40_000,
      rate: isAnnualReturn(saved.projection?.rate) ? saved.projection.rate : 7,
      years: isHorizon(saved.projection?.years) ? saved.projection.years : 20
    }
  };
}
