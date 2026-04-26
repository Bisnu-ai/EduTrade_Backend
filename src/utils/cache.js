const NodeCache = require("node-cache");

// Initialize cache with default TTL of 10 minutes and check period of 2 minutes
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

/**
 * Cache Utility functions
 */
const cacheUtil = {
  /**
   * Set a value in cache
   */
  set: (key, value, ttl) => {
    return cache.set(key, value, ttl);
  },

  /**
   * Get a value from cache
   */
  get: (key) => {
    return cache.get(key);
  },

  /**
   * Delete a value from cache
   */
  del: (key) => {
    return cache.del(key);
  },

  /**
   * Flush all cache (use when major data changes)
   */
  flush: () => {
    return cache.flushAll();
  },

  /**
   * Helper to delete all keys matching a prefix
   */
  delByPrefix: (prefix) => {
    const keys = cache.keys();
    const keysToDelete = keys.filter(key => key.startsWith(prefix));
    if (keysToDelete.length > 0) {
      cache.del(keysToDelete);
    }
  }
};

module.exports = cacheUtil;
