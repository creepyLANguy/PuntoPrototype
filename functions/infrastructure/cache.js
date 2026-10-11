function createApiResponseCache(ttlMs, maxEntries) {
  const entries = new Map();
  let bypass = false;

  return {
    get(courtId) {
      if (bypass) return null;
      const entry = entries.get(courtId);
      if (!entry) return null;

      if (Date.now() > entry.expiresAt) {
        entries.delete(courtId);
        return null;
      }

      return entry;
    },

    set(courtId, status, body) {
      if (bypass) return;
      if (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value;
        entries.delete(oldestKey);
      }

      entries.set(courtId, {
        status,
        body,
        expiresAt: Date.now() + ttlMs,
      });
    },

    clear(courtId) {
      entries.delete(courtId);
    },

    // Drops every entry: an ID retention cull changed which generation an
    // id resolves to.
    clearAll() {
      entries.clear();
    },

    // While a cull runs, responses are neither served from nor stored in
    // the instance cache.
    setBypass(value) {
      bypass = Boolean(value);
      if (bypass) entries.clear();
    },
  };
}

module.exports = { createApiResponseCache };
