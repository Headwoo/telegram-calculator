import { normalizeSettings } from "./settings.mjs";

const LEGACY_KEY = "balance.settings.v1";
const PREFIX = "balance.settings.v2";
const CHUNK_SIZE = 3500;
const MAX_CHUNKS = 32;

function parse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function envelope(value) {
  return value?.version === 2 && Number.isFinite(value.updatedAt) &&
    value.settings && typeof value.settings === "object"
    ? { version: 2, updatedAt: value.updatedAt, settings: normalizeSettings(value.settings) } : null;
}

// CloudStorage is already isolated by Telegram user and bot. The ID also scopes
// the browser cache so switching accounts on one device never shares a budget.
export function createSettingsStore({ telegram, storage, onStatus = () => {}, onChange = () => {}, timeout = 6000, debounce = 400 }) {
  const id = telegram?.initDataUnsafe?.user?.id;
  const userId = Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  const identity = userId ? "telegram." + userId : telegram ? "telegram-unavailable" : "browser";
  const key = PREFIX + "." + identity;
  const cloud = userId && telegram.isVersionAtLeast?.("6.9") ? telegram.CloudStorage : null;
  // An unidentified Telegram launch must not use another visitor's guest cache.
  const read = name => { try { return identity === "telegram-unavailable" ? null : storage?.getItem(name); } catch { return null; } };
  const write = (name, value) => {
    try {
      if (!storage || identity === "telegram-unavailable") return false;
      storage.setItem(name, value);
      return true;
    } catch { return false; }
  };
  let current = envelope(parse(read(key)));
  let knownBudget = Boolean(current && parse(read(key))?.initialized !== false);
  let pending = Boolean(parse(read(key))?.pending);
  let localSaved = Boolean(current);
  if (!current) {
    const legacy = parse(read(LEGACY_KEY));
    const owner = read(LEGACY_KEY + ".owner");
    // Claim the old unscoped cache once; never import it into a second account.
    const migrated = legacy && (!owner || owner === identity) && write(LEGACY_KEY + ".owner", identity);
    // The v1 format has no edit time; an existing newer cloud budget wins.
    current = { version: 2, updatedAt: 0, settings: normalizeSettings(migrated ? legacy : {}) };
    pending = Boolean(migrated);
    knownBudget = Boolean(migrated);
  }
  let cloudLoaded = false;
  let manifest = null;
  let timer;
  let running;

  function cache() {
    localSaved = write(key, JSON.stringify({ ...current, pending, initialized: knownBudget }));
  }

  function status() {
    onStatus(!userId && telegram ? "Profile unavailable — reopen from Telegram" :
      cloud && !cloudLoaded && !knownBudget ? "Could not load your budget · Reconnect and retry" :
      !cloud ? localSaved ? "Saved on this device" : "Changes cannot be saved on this device" :
      pending || !cloudLoaded ? localSaved ? "Saved on device · Sync pending" : "Not saved · Sync pending" : "Saved in Telegram");
  }

  function call(method, ...args) {
    return new Promise((resolve, reject) => {
      const limit = setTimeout(() => reject(new Error("Telegram storage timed out")), timeout);
      try {
        cloud[method](...args, (error, result) => {
          clearTimeout(limit);
          if (error) reject(new Error(String(error)));
          else if (method === "setItem" && result !== true) reject(new Error("Telegram did not save the value"));
          else resolve(result);
        });
      } catch (error) { clearTimeout(limit); reject(error); }
    });
  }

  const cloudKey = "balance_v2_" + (userId ?? "") + "_";
  async function readCloud() {
    const raw = await call("getItem", cloudKey + "head");
    if (!raw) { manifest = null; return null; }
    const head = parse(raw);
    if (![0, 1].includes(head?.slot) || !Number.isInteger(head.count) || head.count < 1 || head.count > MAX_CHUNKS) {
      throw new Error("Invalid saved budget manifest");
    }
    const keys = Array.from({ length: head.count }, (_, index) => cloudKey + head.slot + "_" + index);
    const chunks = await call("getItems", keys);
    if (keys.some(name => typeof chunks?.[name] !== "string")) throw new Error("Incomplete saved budget");
    const remote = envelope(parse(keys.map(name => chunks[name]).join("")));
    if (!remote) throw new Error("Invalid saved budget");
    manifest = head;
    return remote;
  }

  async function reconcile() {
    const previous = JSON.stringify(current.settings);
    const wasKnown = knownBudget;
    const remote = await readCloud();
    // Pending offline work competes by edit time. A clean cache always refreshes
    // from Telegram, including changes made on a different device.
    if (remote && (!pending || remote.updatedAt > current.updatedAt)) {
      current = remote;
      pending = false;
      cache();
    } else if (!remote || pending) {
      pending = true;
      cache();
    }
    cloudLoaded = true;
    knownBudget = true;
    cache();
    if (!wasKnown || JSON.stringify(current.settings) !== previous) onChange(structuredClone(current.settings));
  }

  async function sync() {
    try {
      if (!cloudLoaded) await reconcile();
      while (pending) {
        const snapshot = current;
        const serialized = JSON.stringify(snapshot);
        const chunks = [];
        let chunk = "";
        // Keep surrogate pairs together when splitting Unicode category names.
        for (const character of serialized) {
          if (chunk.length + character.length > CHUNK_SIZE) { chunks.push(chunk); chunk = ""; }
          chunk += character;
        }
        if (chunk) chunks.push(chunk);
        if (chunks.length > MAX_CHUNKS) throw new Error("Budget exceeds Telegram storage capacity");
        const slot = manifest?.slot === 0 ? 1 : 0;
        onStatus("Saving to Telegram…");
        for (let index = 0; index < chunks.length; index++) {
          await call("setItem", cloudKey + slot + "_" + index, chunks[index]);
        }
        // Publish the pointer only after every chunk succeeds. A partial save
        // leaves the previous complete budget readable. Slots bound key usage.
        const next = { slot, count: chunks.length };
        await call("setItem", cloudKey + "head", JSON.stringify(next));
        manifest = next;
        if (current === snapshot) { pending = false; cache(); }
      }
    } catch {
      // Retain the pending snapshot locally; retry on resume or reconnection.
      // A timed-out publish may have reached Telegram: read its pointer before
      // choosing a slot on retry instead of overwriting the active snapshot.
      cloudLoaded = false;
    }
    status();
  }

  async function flush(refresh = false) {
    clearTimeout(timer);
    if (!cloud) { status(); return; }
    if (!running) {
      if (refresh) cloudLoaded = false;
      running = sync().finally(() => { running = null; });
    }
    return running;
  }

  return {
    userId,
    get canEdit() { return identity !== "telegram-unavailable" && (!cloud || cloudLoaded || knownBudget); },
    get settings() { return structuredClone(current.settings); },
    async load() {
      onStatus(cloud ? "Loading your budget…" : "Loading…");
      if (cloud) {
        try { await reconcile(); } catch { /* An offline cache remains usable. */ }
      }
      cache();
      status();
      if (cloud && cloudLoaded && pending) timer = setTimeout(flush, debounce);
      return structuredClone(current.settings);
    },
    save(settings) {
      // On an uncached offline device, default samples must never replace an
      // existing Telegram budget simply because the visitor changed tabs.
      if (identity === "telegram-unavailable" || (cloud && !cloudLoaded && !knownBudget)) { status(); return; }
      current = { version: 2, updatedAt: Math.max(Date.now(), current.updatedAt + 1), settings: normalizeSettings(settings) };
      pending = true;
      cache();
      status();
      clearTimeout(timer);
      if (cloud) timer = setTimeout(flush, debounce);
    },
    flush
  };
}
