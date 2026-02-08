/**
 * Upstash Redis client. When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 * are set, exports a real client. Otherwise exports a no-op stub so the app can
 * start without Redis; risk/cron routes should check isConfigured and respond
 * accordingly (e.g. 503 for cron, safe default for risk).
 */
let redis;
let isConfigured = false;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    const { Redis } = require('@upstash/redis');
    redis = Redis.fromEnv();
    isConfigured = true;
  } catch (e) {
    redis = createStub();
  }
} else {
  redis = createStub();
}

function createStub() {
  return {
    async get() {
      return null;
    },
    async set() {
      return 'OK';
    },
    async del() {
      return 0;
    },
    async sadd() {
      return 0;
    },
    async sismember() {
      return 0;
    },
    async smembers() {
      return [];
    },
  };
}

module.exports = { redis, isConfigured };
