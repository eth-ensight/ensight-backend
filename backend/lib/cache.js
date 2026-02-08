/**
 * Simple in-memory TTL cache for ENS lookups.
 *
 * ENS records change infrequently, so caching significantly reduces RPC calls.
 * Default TTL is 5 minutes. Cache is bounded to prevent unbounded memory growth.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 10000;

class TTLCache {
  /**
   * @param {number} [ttlMs] - Time-to-live in milliseconds (default: 5 min)
   * @param {number} [maxEntries] - Maximum cache entries (default: 10000)
   */
  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES) {
    this._ttlMs = ttlMs;
    this._maxEntries = maxEntries;
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this._store = new Map();
  }

  /**
   * Get a value from the cache.
   * Returns undefined if not found or expired.
   *
   * @param {string} key
   * @returns {any|undefined}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Set a value in the cache.
   *
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlMs] - Override TTL for this entry
   */
  set(key, value, ttlMs) {
    // Evict oldest entries if at capacity
    if (this._store.size >= this._maxEntries) {
      const oldest = this._store.keys().next().value;
      this._store.delete(oldest);
    }
    this._store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this._ttlMs),
    });
  }

  /**
   * Check if a key exists and is not expired.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a specific key.
   *
   * @param {string} key
   */
  delete(key) {
    this._store.delete(key);
  }

  /** Clear the entire cache. */
  clear() {
    this._store.clear();
  }

  /** Number of entries currently in the cache (including expired). */
  get size() {
    return this._store.size;
  }
}

// Singleton cache instance used across the backend
const ensCache = new TTLCache();

module.exports = { TTLCache, ensCache };
