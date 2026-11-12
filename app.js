import {
  MAX_MONEY_CENTS, MAX_YEARS, MIN_RETURN, MAX_RETURN,
  MIN_INVESTMENT_BASIS_POINTS, MAX_INVESTMENT_BASIS_POINTS, SAVINGS_BASIS_POINTS,
  parseMoney, parseInvestmentRate, isAnnualReturn, isHorizon,
  compoundProjection, paycheckSplit
} from "./finance.mjs";
import { CATEGORY_COLORS, MAX_CATEGORIES, MAX_CATEGORY_NAME, validCategoryName } from "./settings.mjs";
import { createSettingsStore } from "./storage.mjs";
import { createLiquidTabs } from "./liquid-tabs.mjs";

const root = document.documentElement;
const byId = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
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

// The SDK script is ordered before this module in index.html.
const sdk = window.Telegram?.WebApp;
const launchParams = new URLSearchParams(window.location.hash.slice(1));
const inTelegram = Boolean(sdk?.initData || (sdk?.platform && sdk.platform !== "unknown") || launchParams.has("tgWebAppData") || launchParams.has("tgWebAppPlatform"));
const telegram = inTelegram ? sdk : null;
let local;
try { local = window.localStorage; } catch { /* Storage may be unavailable. */ }
const store = createSettingsStore({
  telegram: inTelegram ? telegram ?? {} : null, storage: local,
  onStatus: message => {
    if (byId("save-status").textContent !== message) byId("save-status").textContent = message;
    byId("retry-sync").hidden = store.canEdit || !store.userId || message.startsWith("Loading");
  },
  onChange: next => {
    if (!appReady) return;
    byId("app-content").inert = !store.canEdit;
    Object.assign(settings, next);
    renderTheme();
    for (const { id, format } of projectionFields) byId(id).value = format(settings.projection[id]);
    byId("growth-error").hidden = true;
    byId("growth-details").hidden = false;
    for (const { id } of projectionFields) setFieldError(byId(id), false);
    renderProjection();
    renderMonthlyPlan();
    selectTab(byId("tab-" + settings.activeTab), false);
  }
});
let appReady = false;
const user = telegram?.initDataUnsafe?.user;
byId("profile-name").textContent = store.userId ? [user.first_name, user.last_name].filter(Boolean).join(" ") || "My Telegram profile" : "Personal budget";
byId("app-content").inert = true;
telegram?.ready();
telegram?.expand();
const settings = await store.load();
byId("app-content").inert = !store.canEdit;
byId("retry-sync").addEventListener("click", () => store.flush());

function saveSettings() { store.save(settings); }

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
const liquidTabs = createLiquidTabs(tablist, { onSelect: tab => selectTab(tab) });

function selectTab(selected, persist = true) {
  const previous = tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true");
  const next = tabs.indexOf(selected);
  const screen = selected.getAttribute("aria-controls");
  byId("screen-title").textContent = titles[screen];
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    byId(tab.getAttribute("aria-controls")).hidden = !active;
  }
  liquidTabs.select(selected, { instant: !persist });
  if (persist && previous !== next && !liquidTabs.reducedMotion) {
    const panel = byId(screen);
    for (const animation of panel.getAnimations()) animation.cancel();
    panel.animate([
      { opacity: .35, transform: `translateX(${next > previous ? 12 : -12}px) scale(.992)` },
      { opacity: 1, transform: "translateX(0) scale(1)" }
    ], { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" });
  }
  settings.activeTab = screen;
  if (persist) saveSettings();
  window.scrollTo(0, 0);
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
    const subtitle = detail ? "<small>" + escapeHtml(detail) + "</small>" : "";
    return `<li>
      <span class="row-icon" style="--item: var(--${color})"><svg class="icon" aria-hidden="true"><use href="#icon-${icon}"></use></svg></span>
      <span class="account-label">${escapeHtml(label)}${subtitle}</span><strong>${money(amount)}</strong>
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
  const rows = settings.categories.map(category => ({ ...category, amount: settings.expenses[category.id] }));
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
let draftCategories = [];
const addCategoryButton = byId("add-category");

function moneyField(id, label, value) {
  return { id, label, value: moneyInput(value), prefix: "$", parse: parseMoney, error: moneyError(label) };
}

function fieldMarkup({ id, label, value, prefix, suffix }) {
  return `<label class="field" for="edit-${id}">${escapeHtml(label)}
    <span class="field-control">
      ${prefix ? '<b aria-hidden="true">' + escapeHtml(prefix) + "</b>" : ""}
      <input id="edit-${id}" name="${id}" aria-label="${escapeHtml(label)}" inputmode="decimal" enterkeyhint="done" autocomplete="off" aria-describedby="editor-error" value="${escapeHtml(value)}">
      ${suffix ? '<b aria-hidden="true">' + escapeHtml(suffix) + "</b>" : ""}
    </span>
  </label>`;
}

function appendCategoryEditor(category, amount) {
  const field = moneyField("expense-" + category.id, "Monthly amount", amount);
  editedFields.push(field);
  const row = document.createElement("div");
  row.className = "category-editor-row";
  row.innerHTML = `<label class="field" for="name-${category.id}">Category name
    <span class="field-control"><input id="name-${category.id}" name="name-${category.id}"
      maxlength="${MAX_CATEGORY_NAME}" aria-label="Category name" aria-describedby="editor-error"
      autocomplete="off" enterkeyhint="next" value="${escapeHtml(category.label)}"></span>
    </label>${fieldMarkup(field)}`;
  editorFields.append(row);
  addCategoryButton.disabled = draftCategories.length >= MAX_CATEGORIES;
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
  editorFields.classList.toggle("budget-editor", budget);
  addCategoryButton.hidden = !budget;
  editedFields = [moneyField("income", budget ? "Take-home pay" : "Monthly take-home pay", settings.income)];
  draftCategories = budget ? settings.categories.map(category => ({ ...category })) : [];
  if (!budget) {
    editedFields.push({
      id: "investment", label: "Stock market contribution", value: String(settings.investmentRate / 100),
      suffix: "%", parse: parseInvestmentRate, error: investmentError
    });
  }
  editorFields.innerHTML = editedFields.map(fieldMarkup).join("");
  if (budget) for (const category of draftCategories) appendCategoryEditor(category, settings.expenses[category.id]);
  editor.showModal();
  backButton?.show();
}

addCategoryButton.addEventListener("click", () => {
  if (draftCategories.length >= MAX_CATEGORIES) return;
  const category = {
    id: "category_" + crypto.randomUUID(), label: "",
    color: CATEGORY_COLORS[draftCategories.length % CATEGORY_COLORS.length], icon: "receipt"
  };
  draftCategories.push(category);
  appendCategoryEditor(category, 0);
  byId("name-" + category.id).focus();
});

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
  for (const category of draftCategories) {
    const input = byId("name-" + category.id);
    const invalid = !validCategoryName(input.value);
    setFieldError(input, invalid);
    if (invalid && !firstError) firstError = { input, error: "Enter a category name from 1 to " + MAX_CATEGORY_NAME + " characters." };
  }
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
    settings.categories = draftCategories.map(category => ({ ...category, label: byId("name-" + category.id).value.trim() }));
    settings.expenses = Object.fromEntries(settings.categories.map(({ id }) => [id, values["expense-" + id]]));
  } else {
    settings.investmentRate = values.investment;
  }
  renderMonthlyPlan();
  saveSettings();
  document.activeElement?.blur();
  editor.close();
});

// iOS does not consistently blur text inputs when tapping a non-focusable
// element. Do it explicitly without cancelling taps, labels, or button actions.
function dismissKeyboard(event) {
  if (event.target instanceof Element && event.target.closest("input, textarea, select, label, [contenteditable]:not([contenteditable='false'])")) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) active.blur();
}
document.addEventListener(window.PointerEvent ? "pointerdown" : "touchstart", dismissKeyboard, { capture: true, passive: true });
window.addEventListener("online", () => store.flush(true));
window.addEventListener("pagehide", () => store.flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") store.flush(true);
});
setInterval(() => store.flush(), 30_000);

if (telegram) {
  root.dataset.telegram = "";
  telegram.onEvent("themeChanged", renderTheme);
}
renderTheme();
renderProjection();
renderMonthlyPlan();
selectTab(byId("tab-" + settings.activeTab), false);
appReady = true;
