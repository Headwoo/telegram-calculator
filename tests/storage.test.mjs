import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsStore } from "../storage.mjs";
import { normalizeSettings, MAX_CATEGORIES } from "../settings.mjs";

function localStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function telegram(id, values = new Map()) {
  const api = {
    initDataUnsafe: { user: { id } }, isVersionAtLeast: () => true,
    CloudStorage: {
      getItem: (key, callback) => callback(null, values.get(key) ?? ""),
      getItems: (keys, callback) => callback(null, Object.fromEntries(keys.map(key => [key, values.get(key)]))),
      setItem: (key, value, callback) => {
        assert.ok(value.length <= 4096);
        values.set(key, value);
        callback(null, true);
      }
    }
  };
  return api;
}

function store(options) { return createSettingsStore({ debounce: 0, timeout: 20, ...options }); }

test("isolates two Telegram IDs sharing one browser and restores each budget", async () => {
  const storage = localStorage();
  const cloud = new Map();
  const first = store({ telegram: telegram(101, cloud), storage });
  const saved = await first.load();
  saved.income = 987_654;
  saved.activeTab = "budget";
  saved.theme = "dark";
  saved.projection.years = 35;
  saved.categories[0].label = "My rent";
  saved.categories.push({ id: "new_category", label: "Travel", color: "pink", icon: "receipt" });
  saved.expenses.new_category = 12_345;
  first.save(saved);
  await first.flush();

  const second = store({ telegram: telegram(202, cloud), storage });
  assert.equal((await second.load()).income, 520_000);
  await second.flush();
  const again = store({ telegram: telegram(101, cloud), storage });
  assert.deepEqual(await again.load(), saved);
});

test("restores all settings on a new device and replaces an older clean cache", async () => {
  const cloud = new Map();
  const oldDevice = localStorage();
  const initial = store({ telegram: telegram(101, cloud), storage: oldDevice });
  await initial.load();
  await initial.flush();
  const other = store({ telegram: telegram(101, cloud), storage: localStorage() });
  const changed = await other.load();
  changed.income = 777_700;
  changed.investmentRate = 2500;
  other.save(changed);
  await other.flush();
  const restored = store({ telegram: telegram(101, cloud), storage: oldDevice });
  assert.deepEqual(await restored.load(), changed);
  await initial.flush(true);
  assert.deepEqual(initial.settings, changed, "resuming an open app also refreshes its clean cache");
});

test("migrates the original unscoped budget to only the first profile", async () => {
  const storage = localStorage();
  storage.setItem("balance.settings.v1", JSON.stringify({ income: 123_400, expenses: { housing: 45_600 }, theme: "dark" }));
  const first = store({ telegram: telegram(101), storage });
  const migrated = await first.load();
  assert.equal(migrated.income, 123_400);
  assert.equal(migrated.expenses.housing, 45_600);
  assert.equal(migrated.theme, "dark");
  await first.flush();
  const second = store({ telegram: telegram(202), storage });
  assert.equal((await second.load()).income, 520_000);
  await second.flush();
});

test("stores a large custom budget in bounded chunks across devices", async () => {
  const cloud = new Map();
  const first = store({ telegram: telegram(101, cloud), storage: localStorage() });
  const saved = await first.load();
  saved.categories = Array.from({ length: MAX_CATEGORIES }, (_, index) => ({
    id: "custom_" + index, label: "🪴".repeat(32), color: "blue", icon: "receipt"
  }));
  saved.expenses = Object.fromEntries(saved.categories.map(({ id }) => [id, 999_999]));
  first.save(saved);
  await first.flush();
  const second = store({ telegram: telegram(101, cloud), storage: localStorage() });
  assert.deepEqual(await second.load(), saved);
  for (let i = 0; i < 5; i++) { saved.income++; first.save(saved); await first.flush(); }
  assert.ok(cloud.size <= 65, "two slots plus the manifest bound key usage");
});

test("a stale legacy cache does not overwrite a newer budget saved on another device", async () => {
  const cloud = new Map();
  const first = store({ telegram: telegram(101, cloud), storage: localStorage() });
  const saved = await first.load();
  saved.income = 876_500;
  first.save(saved);
  await first.flush();
  const storage = localStorage();
  storage.setItem("balance.settings.v1", JSON.stringify({ income: 123_400 }));
  const migrated = store({ telegram: telegram(101, cloud), storage });
  assert.deepEqual(await migrated.load(), saved);
});

test("partial cloud writes preserve the last complete budget and retain pending edits", async () => {
  const cloud = new Map();
  const storage = localStorage();
  const api = telegram(101, cloud);
  const first = store({ telegram: api, storage });
  const original = await first.load();
  await first.flush();
  const realWrite = api.CloudStorage.setItem;
  api.CloudStorage.setItem = (key, value, callback) => key.endsWith("head") ? callback("offline") : realWrite(key, value, callback);
  const changed = structuredClone(original);
  changed.income = 999_900;
  first.save(changed);
  await first.flush();
  const anotherDevice = store({ telegram: telegram(101, cloud), storage: localStorage() });
  assert.deepEqual(await anotherDevice.load(), original);
  api.CloudStorage.setItem = realWrite;
  const retry = store({ telegram: api, storage });
  assert.deepEqual(await retry.load(), changed);
  await retry.flush();
  const restored = store({ telegram: telegram(101, cloud), storage: localStorage() });
  assert.deepEqual(await restored.load(), changed);
});

test("offline startup never overwrites an existing cloud budget before reading it", async () => {
  const cloud = new Map();
  const api = telegram(101, cloud);
  const source = store({ telegram: api, storage: localStorage() });
  const saved = await source.load();
  saved.income = 321_000;
  source.save(saved);
  await source.flush();
  const realRead = api.CloudStorage.getItem;
  api.CloudStorage.getItem = (key, callback) => callback("offline");
  let updates = null;
  const offline = store({ telegram: api, storage: localStorage(), onChange: next => { updates = next; } });
  assert.equal((await offline.load()).income, 520_000);
  assert.equal(offline.canEdit, false);
  offline.save(normalizeSettings({ activeTab: "budget" }));
  api.CloudStorage.getItem = realRead;
  await offline.flush();
  assert.equal(offline.canEdit, true);
  assert.equal(updates.income, saved.income);
  assert.deepEqual(offline.settings, saved);
});

test("saves made during a cloud write are flushed in order", async () => {
  const cloud = new Map();
  const api = telegram(101, cloud);
  const first = store({ telegram: api, storage: localStorage() });
  const saved = await first.load();
  await first.flush();
  const write = api.CloudStorage.setItem;
  let edited = false;
  api.CloudStorage.setItem = (key, value, callback) => {
    if (!edited) {
      edited = true;
      first.save({ ...saved, income: 888_800 });
    }
    write(key, value, callback);
  };
  first.save({ ...saved, income: 111_100 });
  await first.flush();
  const restored = store({ telegram: telegram(101, cloud), storage: localStorage() });
  assert.equal((await restored.load()).income, 888_800);
});

test("storage denial still permits Telegram saving; no-ID launches never expose the browser cache", async () => {
  const cloud = new Map();
  const denied = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
  const first = store({ telegram: telegram(101, cloud), storage: denied });
  const saved = await first.load();
  saved.income = 222_200;
  first.save(saved);
  await first.flush();
  assert.deepEqual(await store({ telegram: telegram(101, cloud), storage: localStorage() }).load(), saved);
  const storage = localStorage();
  const browser = store({ storage });
  const guest = await browser.load();
  guest.income = 999_900;
  browser.save(guest);
  const unidentified = store({ telegram: { initDataUnsafe: {}, isVersionAtLeast: () => true }, storage });
  assert.equal((await unidentified.load()).income, 520_000);
});

test("normalizes malformed stored categories without invalid amounts or presentation markup", () => {
  const settings = normalizeSettings({ categories: [
    { id: "valid", label: "Hello <img>", color: "arbitrary", icon: "unknown" },
    { id: "valid", label: "Duplicate" }, { id: "bad<id", label: "Invalid" },
    { id: "blank", label: "  " }
  ], expenses: { valid: -1 } });
  assert.deepEqual(settings.categories, [{ id: "valid", label: "Hello <img>", color: "blue", icon: "receipt" }]);
  assert.equal(settings.expenses.valid, 0);
});
