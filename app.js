import {
  MAX_MONEY_CENTS, MAX_YEARS, MIN_RETURN, MAX_RETURN,
  MIN_INVESTMENT_BASIS_POINTS, MAX_INVESTMENT_BASIS_POINTS, SAVINGS_BASIS_POINTS,
  isMoney, parseMoney, isInvestmentRate, parseInvestmentRate, isAnnualReturn, isHorizon,
  compoundProjection, paycheckSplit
} from "./finance.mjs";

const root = document.documentElement;
const byId = id => document.getElementById(id);
const storageKey = "balance.settings.v1";
const categories = [
  { id: "housing", label: "Housing", color: "blue", icon: "house", initial: 165_000 },
  { id: "groceries", label: "Groceries", color: "teal", icon: "basket", initial: 56_000 },
  { id: "transport", label: "Transport", color: "violet", icon: "car", initial: 42_000 },
  { id: "bills", label: "Bills", color: "amber", icon: "receipt", initial: 37_000 },
  { id: "lifestyle", label: "Lifestyle", color: "pink", icon: "coffee", initial: 45_000 }
];
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const scientific = new Intl.NumberFormat("en-US", { notation: "scientific", maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 });
const titles = { growth: "Compound interest", budget: "Monthly budget", split: "Paycheck split" };

function moneyInput(cents) {
  return (cents % 100 === 0 ? integer : decimal).format(cents / 100);
}

function money(cents) {
  return "$" + moneyInput(cents);
}

function projectionMoney(dollars, axis = false) {
  const magnitude = Math.abs(dollars);
  let formatter = integer;
  if (magnitude >= 1e15) formatter = scientific;
  else if (magnitude >= (axis ? 1e3 : 1e7)) formatter = compact;
  else if (magnitude > 0 && magnitude < 1) formatter = decimal;
  return (dollars <= -.005 ? "−" : "") + "$" + formatter.format(magnitude);
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) ?? {};
  } catch {
    return {};
  }
}

const saved = loadSettings();
const settings = {
  theme: ["dark", "light"].includes(saved.theme) ? saved.theme : null,
  income: isMoney(saved.income) ? saved.income : 520_000,
  investmentRate: isInvestmentRate(saved.investmentRate) ? saved.investmentRate : MIN_INVESTMENT_BASIS_POINTS,
  expenses: Object.fromEntries(categories.map(({ id, initial }) => {
    const value = saved.expenses?.[id];
    return [id, isMoney(value) ? value : initial];
  })),
  projection: {
    principal: isMoney(saved.projection?.principal) ? saved.projection.principal : 1_000_000,
    contribution: isMoney(saved.projection?.contribution) ? saved.projection.contribution : 40_000,
    rate: isAnnualReturn(saved.projection?.rate) ? saved.projection.rate : 7,
    years: isHorizon(saved.projection?.years) ? saved.projection.years : 20
  }
};

function saveSettings() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // The calculators also work when the browser denies local storage.
  }
}

const sdk = window.Telegram?.WebApp;
const inTelegram = Boolean(sdk?.initData || (sdk?.platform && sdk.platform !== "unknown"));
const telegram = inTelegram ? sdk : null;
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const themeButton = byId("theme-button");
const metaTheme = document.querySelector('meta[name="theme-color"]');

function renderTheme() {
  const theme = settings.theme ?? telegram?.colorScheme ?? (systemTheme.matches ? "dark" : "light");
  const dark = theme === "dark";
  root.dataset.theme = dark ? "dark" : "light";
  themeButton.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  byId("theme-icon").setAttribute("href", dark ? "#icon-sun" : "#icon-moon");
  const pageColor = dark ? "#101322" : "#f0f2fa";
  metaTheme.content = pageColor;

  if (!telegram) return;
  if (telegram.isVersionAtLeast("6.9")) telegram.setHeaderColor(dark ? "#202449" : "#d9ddfb");
  if (telegram.isVersionAtLeast("6.1")) telegram.setBackgroundColor(pageColor);
  if (telegram.isVersionAtLeast("7.10")) telegram.setBottomBarColor(dark ? "#171e36" : "#dfe9fc");
}

themeButton.addEventListener("click", () => {
  settings.theme = root.dataset.theme === "dark" ? "light" : "dark";
  renderTheme();
  saveSettings();
});
systemTheme.addEventListener("change", renderTheme);

const tablist = document.querySelector('[role="tablist"]');
const tabs = [...tablist.querySelectorAll('[role="tab"]')];

function selectTab(selected) {
  const screen = selected.getAttribute("aria-controls");
  byId("screen-title").textContent = titles[screen];
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    byId(tab.getAttribute("aria-controls")).hidden = !active;
  }
  window.scrollTo(0, 0);
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
}
tablist.addEventListener("keydown", event => {
  const index = tabs.indexOf(event.target);
  if (index < 0) return;
  const destinations = {
    ArrowRight: (index + 1) % tabs.length,
    ArrowLeft: (index + tabs.length - 1) % tabs.length,
    Home: 0,
    End: tabs.length - 1
  };
  const destination = destinations[event.key];
  if (typeof destination !== "number") return;
  event.preventDefault();
  selectTab(tabs[destination]);
  tabs[destination].focus();
});

const moneyError = label => label + " must be between $0 and " + money(MAX_MONEY_CENTS) + ", with up to two decimal places.";
const rateError = "Annual return must be between " + MIN_RETURN + "% and " + MAX_RETURN + "%.";
const horizonError = "Time horizon must be a whole number from 1 to " + MAX_YEARS + " years.";
const investmentError = "Stock market contribution must be between " + percent.format(MIN_INVESTMENT_BASIS_POINTS / 10_000) +
  " and " + percent.format(MAX_INVESTMENT_BASIS_POINTS / 10_000) + ", with up to two decimal places.";
const projectionFields = [
  { id: "principal", parse: parseMoney, format: moneyInput, error: moneyError("Starting amount") },
  { id: "contribution", parse: parseMoney, format: moneyInput, error: moneyError("Monthly contribution") },
  { id: "rate", parse: text => text !== "" && isAnnualReturn(Number(text)) ? Number(text) : null, format: String, error: rateError },
  { id: "years", parse: text => /^\d+$/.test(text) && isHorizon(Number(text)) ? Number(text) : null, format: String, error: horizonError }
];

function setFieldError(input, invalid) {
  if (invalid) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

for (const { id, format, parse } of projectionFields) {
  const input = byId(id);
  input.value = format(settings.projection[id]);
  input.addEventListener("blur", () => {
    const value = parse(input.value.trim());
    if (value !== null) input.value = format(value);
  });
}
byId("rate").min = MIN_RETURN;
byId("rate").max = MAX_RETURN;

function updateProjection() {
  const projection = {};
  let message = "";
  for (const { id, parse, error } of projectionFields) {
    const input = byId(id);
    const value = parse(input.value.trim());
    setFieldError(input, value === null);
    if (value === null && !message) message = error;
    projection[id] = value;
  }
  const invalid = message !== "";
  byId("growth-error").textContent = message;
  byId("growth-error").hidden = !invalid;
  byId("growth-details").hidden = invalid;
  if (invalid) {
    byId("growth-total").value = "—";
    byId("growth-period").textContent = "—";
    return;
  }
  settings.projection = projection;
  renderProjection();
  saveSettings();
}

byId("growth-form").addEventListener("input", updateProjection);
byId("growth-form").addEventListener("submit", event => {
  event.preventDefault();
  updateProjection();
});

function renderProjection() {
  const { years } = settings.projection;
  const { balance, contributions, change, points } = compoundProjection(settings.projection);
  byId("growth-total").value = projectionMoney(balance);
  byId("growth-period").textContent = years + (years === 1 ? " year" : " years");
  byId("growth-contributions").textContent = projectionMoney(contributions);
  byId("growth-change-label").textContent = change < 0 ? "Estimated loss" : "Estimated growth";
  byId("growth-change").textContent = projectionMoney(change);
  byId("growth-change").classList.toggle("negative", change <= -.5);

  const maximum = Math.max(balance, contributions);
  const step = maximum === 0 ? 25 : 10 ** Math.floor(Math.log10(maximum)) / 4;
  const top = maximum === 0 ? 100 : Math.ceil(maximum / step) * step;
  byId("axis-top").textContent = projectionMoney(top, true);
  byId("axis-mid").textContent = projectionMoney(top / 2, true);
  byId("axis-mid-year").textContent = years / 2 + " yr";
  byId("axis-end-year").textContent = years + " yr";
  byId("growth-chart").setAttribute("aria-label", "Projected balance " + projectionMoney(balance) +
    " and contributions " + projectionMoney(contributions) + " over " + years + (years === 1 ? " year." : " years."));

  const coordinates = (point, key) => {
    const x = 2 + 296 * point.year / years;
    const y = 105 - 98 * (point[key] / top);
    return x.toFixed(2) + " " + y.toFixed(2);
  };
  const curve = points.map(point => coordinates(point, "balance"));
  const deposits = points.map(point => coordinates(point, "contributions"));
  byId("plot-total").setAttribute("d", "M" + curve.join(" L"));
  byId("plot-contributions").setAttribute("d", "M" + deposits.join(" L"));
  byId("plot-area").setAttribute("d", "M" + [...curve, ...deposits.reverse()].join(" L") + " Z");
}

function renderRows(container, rows) {
  container.innerHTML = rows.map(({ label, color, icon, detail, amount }) => {
    const subtitle = detail ? "<small>" + detail + "</small>" : "";
    return `<li>
      <span class="row-icon" style="--item: var(--${color})"><svg class="icon" aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>
      <span>${label}${subtitle}</span><strong>${money(amount)}</strong>
    </li>`;
  }).join("");
}

function renderBudget(rows, expenses) {
  const left = settings.income - expenses;
  const total = byId("budget-expenses");
  total.textContent = expenses >= 10_000_000 ? "$" + compact.format(expenses / 100) : money(expenses);
  total.classList.toggle("small-total", total.textContent.length > 8);
  byId("budget-income").textContent = money(settings.income);
  byId("budget-left-label").textContent = left < 0 ? "Over budget" : "Left after expenses";
  byId("budget-left").textContent = money(Math.abs(left));
  byId("budget-left").classList.toggle("negative", left < 0);
  byId("budget-left").classList.toggle("positive", left >= 0);
  renderRows(byId("budget-categories"), rows);

  const spending = rows.filter(row => row.amount > 0);
  let start = 0;
  const stops = [];
  for (const { amount, color } of spending) {
    const portion = amount / expenses * 100;
    const end = start + portion;
    const gap = spending.length > 1 ? Math.min(.48, portion * .18) : 0;
    stops.push(`var(--${color}) ${start}% ${end - gap}%`);
    if (gap) stops.push(`transparent ${end - gap}% ${end}%`);
    start = end;
  }
  // A single gradient stop is invalid CSS, so a single category uses a solid fill.
  const ring = byId("donut-ring");
  if (spending.length === 1) ring.style.background = "var(--" + spending[0].color + ")";
  else ring.style.background = stops.length ? "conic-gradient(from -90deg," + stops.join(",") + ")" : "";
  byId("budget-chart").setAttribute("aria-label", spending.length
    ? "Monthly expenses: " + spending.map(row => row.label + " " + money(row.amount)).join(", ") + "."
    : "No monthly expenses.");
}

function renderSplit(expenses) {
  const { income, investmentRate } = settings;
  const { investment, savings, emergency, shortfall } = paycheckSplit(income, expenses, investmentRate);
  const investmentPercent = percent.format(investmentRate / 10_000);
  const minPercent = percent.format(MIN_INVESTMENT_BASIS_POINTS / 10_000);
  const savingsPercent = percent.format(SAVINGS_BASIS_POINTS / 10_000);
  const investmentDetail = investmentPercent + " of take-home pay · " +
    (investmentRate === MIN_INVESTMENT_BASIS_POINTS ? "minimum" : minPercent + " minimum");
  const rows = [
    { label: "Living expenses", detail: "From monthly budget", color: "expense", icon: "receipt", amount: expenses },
    { label: "Stock market", detail: investmentDetail, color: "blue", icon: "trend", amount: investment },
    { label: "High-yield savings", detail: "HISA / HYSA · " + savingsPercent + " of take-home pay", color: "violet", icon: "bank", amount: savings },
    { label: "Emergency fund", detail: "All remaining money", color: "teal", icon: "shield", amount: emergency }
  ];
  byId("split-income").textContent = money(income);
  const emergencyTotal = byId("split-emergency");
  emergencyTotal.textContent = emergency >= 10_000_000 ? "$" + compact.format(emergency / 100) : money(emergency);
  const warning = byId("split-shortfall");
  warning.hidden = shortfall === 0;
  warning.textContent = shortfall ? "Shortfall of " + money(shortfall) + ". Planned allocations exceed take-home pay." : "";
  renderRows(byId("split-accounts"), rows);

  const bar = byId("split-bar");
  const total = expenses + investment + savings + emergency;
  bar.innerHTML = rows.filter(row => row.amount > 0).map(({ amount, color }) =>
    `<span style="--share: ${amount / total}; --item: var(--${color})"></span>`
  ).join("");
  bar.setAttribute("aria-label", total
    ? "Monthly allocation: " + rows.map(row => row.label + " " + money(row.amount)).join(", ") + "."
    : "No money allocated.");
}

function renderMonthlyPlan() {
  const rows = categories.map(category => ({ ...category, amount: settings.expenses[category.id] }));
  const expenses = rows.reduce((total, row) => total + row.amount, 0);
  renderBudget(rows, expenses);
  renderSplit(expenses);
}

const editor = byId("editor");
const editorForm = byId("editor-form");
const editorFields = byId("editor-fields");
const editorError = byId("editor-error");
const editorNote = byId("editor-note");
const backButton = telegram?.isVersionAtLeast("6.1") ? telegram.BackButton : null;
let editedFields = [];
let activeEditor = "";

function moneyField(id, label, value) {
  return { id, label, value: moneyInput(value), prefix: "$", parse: parseMoney, error: moneyError(label) };
}

function showEditor(kind) {
  activeEditor = kind;
  const budget = kind === "budget";
  byId("editor-title").textContent = budget ? "Edit monthly budget" : "Edit paycheck split";
  editorNote.hidden = budget;
  editorNote.textContent = budget ? "" : "Minimum " + percent.format(MIN_INVESTMENT_BASIS_POINTS / 10_000) +
    " for investing. High-yield savings stays at " + percent.format(SAVINGS_BASIS_POINTS / 10_000) + ".";
  editorError.hidden = true;
  editorError.textContent = "";
  editedFields = [moneyField("income", budget ? "Take-home pay" : "Monthly take-home pay", settings.income)];
  if (budget) {
    editedFields.push(...categories.map(({ id, label }) => moneyField(id, label, settings.expenses[id])));
  } else {
    editedFields.push({
      id: "investment", label: "Stock market contribution", value: String(settings.investmentRate / 100),
      suffix: "%", parse: parseInvestmentRate, error: investmentError
    });
  }
  editorFields.innerHTML = editedFields.map(({ id, label, value, prefix, suffix }) => `
    <label class="field" for="edit-${id}">${label}
      <span class="field-control">
        ${prefix ? '<b aria-hidden="true">' + prefix + "</b>" : ""}
        <input id="edit-${id}" name="${id}" aria-label="${label}" inputmode="decimal" autocomplete="off" aria-describedby="editor-error" value="${value}">
        ${suffix ? '<b aria-hidden="true">' + suffix + "</b>" : ""}
      </span>
    </label>
  `).join("");
  editor.showModal();
  backButton?.show();
}

for (const button of document.querySelectorAll("[data-editor]")) {
  button.addEventListener("click", () => showEditor(button.dataset.editor));
}
byId("editor-cancel").addEventListener("click", () => editor.close());
editor.addEventListener("close", () => {
  if (!editor.open) backButton?.hide();
});
backButton?.onClick(() => {
  if (editor.open) editor.close();
});

function readEditor() {
  const values = {};
  let firstError = null;
  for (const { id, parse, error } of editedFields) {
    const input = byId("edit-" + id);
    values[id] = parse(input.value);
    setFieldError(input, values[id] === null);
    if (values[id] === null && !firstError) firstError = { input, error };
  }
  editorError.hidden = !firstError;
  editorError.textContent = firstError?.error ?? "";
  return { values, firstError };
}

editorForm.addEventListener("input", () => {
  if (!editorError.hidden) readEditor();
});
editorForm.addEventListener("submit", event => {
  event.preventDefault();
  const { values, firstError } = readEditor();
  if (firstError) {
    firstError.input.focus();
    return;
  }
  settings.income = values.income;
  if (activeEditor === "budget") {
    for (const { id } of categories) settings.expenses[id] = values[id];
  } else {
    settings.investmentRate = values.investment;
  }
  renderMonthlyPlan();
  saveSettings();
  editor.close();
});

if (telegram) {
  root.dataset.telegram = "";
  telegram.onEvent("themeChanged", renderTheme);
}
renderTheme();
renderProjection();
renderMonthlyPlan();
telegram?.ready();
telegram?.expand();
