function createApiResponseCache(ttlMs, maxEntries) {
  const entries = new Map();

  return {
    get(courtId) {
      const entry = entries.get(courtId);
      if (!entry) return null;

      if (Date.now() > entry.expiresAt) {
        entries.delete(courtId);
        return null;
      }

      return entry;
    },

    set(courtId, status, body) {
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
  };
}

module.exports = { createApiResponseCache };
