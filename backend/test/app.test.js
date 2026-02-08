'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// Mock provider: resolve vitalik.eth, reject invalid .eth, no name for unknown
const testProvider = {
  resolveName: async (name) => {
    if (name === 'vitalik.eth') return '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
    if (name === 'notfound.eth') return null;
    return null;
  },
  lookupAddress: async (addr) => {
    if (addr && addr.toLowerCase() === '0xd8da6bf26964af9d7eed9e03e53415d37aa96045') return 'vitalik.eth';
    return null;
  },
  getResolver: async (name) => {
    if (name === 'notfound.eth') return null;
    return {
      address: '0x0000000000000000000000000000000000000000',
      getText: async (key) => {
        const records = {
          url: 'https://vitalik.ca/',
          'com.twitter': 'VitalikButerin',
          'com.github': 'vbuterin',
          description: 'Ethereum co-founder',
        };
        return records[key] || null;
      },
      getAvatar: async () => ({ url: 'https://example.com/avatar.png' }),
      getContentHash: async () => 'ipfs://QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4',
    };
  },
};
global.__ENSIGHT_TEST_PROVIDER__ = testProvider;

// Mock Redis for risk and cron
const mockRedis = {
  _store: {},
  async get(key) {
    return this._store[key] ?? null;
  },
  async set(key, val) {
    this._store[key] = val;
    return 'OK';
  },
  async del(key) {
    delete this._store[key];
    return 0;
  },
  async sadd(key, ...members) {
    if (!this._store[key]) this._store[key] = new Set();
    const set = this._store[key];
    members.forEach((m) => set.add(m));
    return 0;
  },
  async sismember(key, member) {
    const set = this._store[key];
    return set && set.has(member) ? 1 : 0;
  },
  async smembers(key) {
    const set = this._store[key];
    if (set instanceof Set) return Array.from(set);
    return [];
  },
};
global.__ENSIGHT_TEST_REDIS__ = {
  redis: mockRedis,
  isConfigured: true,
};

const app = require('../app');

describe('Health and root', () => {
  it('GET /health returns 200 and status ok', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.ok(res.body.timestamp);
  });

  it('GET / returns 200 and API info', async () => {
    const res = await request(app).get('/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.endpoints);
    assert.ok(res.body.examples);
  });
});

describe('ENS resolve', () => {
  it('GET /api/ens/resolve/vitalik.eth returns 200 with address', async () => {
    const res = await request(app).get('/api/ens/resolve/vitalik.eth');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.name, 'vitalik.eth');
    assert.strictEqual(res.body.address, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  });

  it('GET /api/ens/resolve/invalid returns 400', async () => {
    const res = await request(app).get('/api/ens/resolve/invalid');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('GET /api/ens/resolve/notfound.eth returns 404', async () => {
    const res = await request(app).get('/api/ens/resolve/notfound.eth');
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.error);
  });
});

describe('ENS reverse', () => {
  it('GET /api/ens/reverse/:address returns 200 with name', async () => {
    const res = await request(app).get(
      '/api/ens/reverse/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.name, 'vitalik.eth');
  });

  it('GET /api/ens/reverse with invalid address returns 400', async () => {
    const res = await request(app).get('/api/ens/reverse/not-an-address');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('GET /api/ens/reverse with unknown address returns 404', async () => {
    const res = await request(app).get(
      '/api/ens/reverse/0x0000000000000000000000000000000000000001'
    );
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.error);
  });
});

describe('Risk route', () => {
  it('GET /api/risk/address/:address returns 200 with flagged false when not in set', async () => {
    const res = await request(app).get(
      '/api/risk/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.flagged, false);
    assert.ok('lastUpdated' in res.body);
  });

  it('GET /api/risk/address/:address returns 200 with flagged true when in set', async () => {
    await mockRedis.sadd('scamsniffer:addresses', '0xbad0000000000000000000000000000000000001');
    const res = await request(app).get(
      '/api/risk/address/0xbad0000000000000000000000000000000000001'
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.flagged, true);
    await mockRedis.del('scamsniffer:addresses');
  });

  it('GET /api/risk/address/invalid returns 400', async () => {
    const res = await request(app).get('/api/risk/address/invalid');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });
});

// Set CRON_SECRET so cron route auth tests can pass (read at request time)
process.env.CRON_SECRET = 'test-cron-secret';

describe('Cron route', () => {
  const CRON_SECRET = process.env.CRON_SECRET;
  const originalFetch = global.fetch;

  it('GET /api/cron/scamsniffer-sync without auth returns 401', async () => {
    const res = await request(app).get('/api/cron/scamsniffer-sync');
    assert.strictEqual(res.status, 401);
  });

  it('GET /api/cron/scamsniffer-sync with wrong secret returns 401', async () => {
    const res = await request(app)
      .get('/api/cron/scamsniffer-sync')
      .set('Authorization', 'Bearer wrong-secret');
    assert.strictEqual(res.status, 401);
  });

  it('GET /api/cron/scamsniffer-sync with auth and mocked fetch returns 200', async () => {
    global.fetch = async (url) => ({
      status: 200,
      headers: new Map([['etag', 'W/"abc"']]),
      json: async () => ['0x1111000000000000000000000000000000000001'],
    });
    const res = await request(app)
      .get('/api/cron/scamsniffer-sync')
      .set('Authorization', `Bearer ${CRON_SECRET}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.count, 1);
    global.fetch = originalFetch;
  });

  it('GET /api/cron/scamsniffer-sync with 304 returns skipped', async () => {
    global.fetch = async () => ({ status: 304 });
    const res = await request(app)
      .get('/api/cron/scamsniffer-sync')
      .set('Authorization', `Bearer ${CRON_SECRET}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.skipped, true);
    global.fetch = originalFetch;
  });
});

// --- Knowledge Graph ---

const ADDR_A = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const ADDR_B = '0x1111000000000000000000000000000000000001';

describe('Graph: POST /api/graph/interaction', () => {
  it('returns 400 without a valid to address', async () => {
    const res = await request(app)
      .post('/api/graph/interaction')
      .send({ from: ADDR_A, to: 'invalid', method: 'eth_sendTransaction', kind: 'tx', hostname: 'app.uniswap.org' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('records an interaction and returns ok', async () => {
    const res = await request(app)
      .post('/api/graph/interaction')
      .send({
        from: ADDR_A,
        to: ADDR_B,
        method: 'eth_sendTransaction',
        kind: 'tx',
        hostname: 'app.uniswap.org',
        value: '1000000000000000000',
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.stored, true);
  });

  it('increments count on duplicate interaction', async () => {
    const res = await request(app)
      .post('/api/graph/interaction')
      .send({
        from: ADDR_A,
        to: ADDR_B,
        method: 'eth_sendTransaction',
        kind: 'tx',
        hostname: 'app.uniswap.org',
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
  });
});

describe('Graph: GET /api/graph/address/:address', () => {
  it('returns 400 for invalid address', async () => {
    const res = await request(app).get('/api/graph/address/invalid');
    assert.strictEqual(res.status, 400);
  });

  it('returns node + edges + riskSummary', async () => {
    const res = await request(app).get(`/api/graph/address/${ADDR_A.toLowerCase()}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.node);
    assert.strictEqual(res.body.node.address, ADDR_A.toLowerCase());
    assert.ok(Array.isArray(res.body.edges));
    assert.ok(res.body.edges.length > 0);
    assert.ok('riskSummary' in res.body);
    assert.strictEqual(res.body.riskSummary.totalNeighborCount, 1);
  });

  it('returns node for the other side of the edge', async () => {
    const res = await request(app).get(`/api/graph/address/${ADDR_B.toLowerCase()}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.node);
    assert.strictEqual(res.body.riskSummary.totalNeighborCount, 1);
  });
});

describe('Graph: GET /api/graph/address/:address/neighbors', () => {
  it('returns 400 for invalid address', async () => {
    const res = await request(app).get('/api/graph/address/invalid/neighbors');
    assert.strictEqual(res.status, 400);
  });

  it('returns neighbors list and edges for ADDR_A', async () => {
    const res = await request(app).get(`/api/graph/address/${ADDR_A.toLowerCase()}/neighbors`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.neighbors));
    assert.strictEqual(res.body.neighbors.length, 1);
    assert.strictEqual(res.body.neighbors[0].address, ADDR_B.toLowerCase());
    assert.ok(Array.isArray(res.body.edges));
    assert.ok(res.body.edges.length > 0);
    // Edge should have type sent_tx
    assert.strictEqual(res.body.edges[0].type, 'sent_tx');
  });
});

// ====================================================================
// ENS utility module (lib/ens.js) tests
// ====================================================================

const {
  normalizeName,
  validateName,
  validateAddress,
  STANDARD_TEXT_KEYS,
  EXTENDED_TEXT_KEYS,
} = require('../lib/ens');

describe('lib/ens: normalizeName', () => {
  it('normalizes a valid .eth name', () => {
    assert.strictEqual(normalizeName('vitalik.eth'), 'vitalik.eth');
  });

  it('lowercases mixed-case names', () => {
    assert.strictEqual(normalizeName('Vitalik.ETH'), 'vitalik.eth');
  });

  it('returns null for empty or non-string input', () => {
    assert.strictEqual(normalizeName(''), null);
    assert.strictEqual(normalizeName(null), null);
    assert.strictEqual(normalizeName(undefined), null);
    assert.strictEqual(normalizeName(123), null);
  });

  it('returns null for names that fail UTS-46', () => {
    // Control characters should fail normalization
    assert.strictEqual(normalizeName('\x00.eth'), null);
  });
});

describe('lib/ens: validateName', () => {
  it('validates a correct .eth name', () => {
    const result = validateName('vitalik.eth');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.normalized, 'vitalik.eth');
    assert.strictEqual(result.error, null);
  });

  it('rejects a name without a TLD', () => {
    const result = validateName('vitalik');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error.includes('TLD'));
  });

  it('rejects empty input', () => {
    const result = validateName('');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });

  it('rejects non-string input', () => {
    const result = validateName(42);
    assert.strictEqual(result.valid, false);
  });

  it('accepts subdomains', () => {
    const result = validateName('sub.vitalik.eth');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.normalized, 'sub.vitalik.eth');
  });
});

describe('lib/ens: validateAddress', () => {
  it('validates a valid checksum address', () => {
    const result = validateAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.error, null);
  });

  it('rejects an invalid address', () => {
    const result = validateAddress('not-an-address');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });

  it('rejects empty input', () => {
    const result = validateAddress('');
    assert.strictEqual(result.valid, false);
  });
});

describe('lib/ens: text key constants', () => {
  it('STANDARD_TEXT_KEYS includes core social keys', () => {
    assert.ok(STANDARD_TEXT_KEYS.includes('url'));
    assert.ok(STANDARD_TEXT_KEYS.includes('com.twitter'));
    assert.ok(STANDARD_TEXT_KEYS.includes('com.github'));
    assert.ok(STANDARD_TEXT_KEYS.includes('com.discord'));
  });

  it('EXTENDED_TEXT_KEYS is a superset of STANDARD_TEXT_KEYS', () => {
    for (const key of STANDARD_TEXT_KEYS) {
      assert.ok(EXTENDED_TEXT_KEYS.includes(key), `EXTENDED missing: ${key}`);
    }
    assert.ok(EXTENDED_TEXT_KEYS.length > STANDARD_TEXT_KEYS.length);
  });
});

// ====================================================================
// ENS contenthash endpoint tests
// ====================================================================

describe('ENS contenthash', () => {
  it('GET /api/ens/contenthash/vitalik.eth returns 200 with contenthash', async () => {
    const res = await request(app).get('/api/ens/contenthash/vitalik.eth');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.name, 'vitalik.eth');
    assert.ok(res.body.contenthash);
    assert.ok(res.body.contenthash.startsWith('ipfs://'));
  });

  it('GET /api/ens/contenthash/invalid returns 400', async () => {
    const res = await request(app).get('/api/ens/contenthash/invalid');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });
});

// ====================================================================
// ENS records endpoint tests
// ====================================================================

describe('ENS records', () => {
  it('GET /api/ens/records/vitalik.eth returns 200 with full record dump', async () => {
    const res = await request(app).get('/api/ens/records/vitalik.eth');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.name, 'vitalik.eth');
    assert.strictEqual(res.body.address, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    assert.ok(res.body.resolver);
    assert.ok(res.body.contenthash);
    assert.ok(res.body.avatar);
    assert.ok(res.body.textRecords);
    assert.strictEqual(res.body.textRecords.url, 'https://vitalik.ca/');
    assert.strictEqual(res.body.textRecords['com.twitter'], 'VitalikButerin');
    assert.strictEqual(res.body.textRecords['com.github'], 'vbuterin');
  });

  it('GET /api/ens/records/invalid returns 400', async () => {
    const res = await request(app).get('/api/ens/records/invalid');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('GET /api/ens/records/notfound.eth returns 404', async () => {
    const res = await request(app).get('/api/ens/records/notfound.eth');
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.error);
  });
});

// ====================================================================
// ENS batch resolution endpoint tests
// ====================================================================

describe('ENS batch: POST /api/ens/batch', () => {
  it('resolves multiple names and addresses', async () => {
    const res = await request(app)
      .post('/api/ens/batch')
      .send({
        names: ['vitalik.eth', 'notfound.eth'],
        addresses: [ADDR_A, ADDR_B],
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);

    // Name results
    assert.strictEqual(
      res.body.results.names['vitalik.eth'].address,
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    );
    assert.strictEqual(res.body.results.names['notfound.eth'].address, null);

    // Address results
    assert.strictEqual(
      res.body.results.addresses[ADDR_A].name,
      'vitalik.eth'
    );
    assert.strictEqual(res.body.results.addresses[ADDR_B].name, null);
  });

  it('returns 400 for invalid body types', async () => {
    const res = await request(app)
      .post('/api/ens/batch')
      .send({ names: 'not-an-array' });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when exceeding batch limit', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `name${i}.eth`);
    const res = await request(app)
      .post('/api/ens/batch')
      .send({ names: tooMany });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('20'));
  });

  it('handles invalid names gracefully in batch', async () => {
    const res = await request(app)
      .post('/api/ens/batch')
      .send({ names: ['invalid-no-tld'], addresses: [] });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.names['invalid-no-tld'].error, 'invalid name');
  });

  it('handles invalid addresses gracefully in batch', async () => {
    const res = await request(app)
      .post('/api/ens/batch')
      .send({ names: [], addresses: ['not-valid'] });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.addresses['not-valid'].error, 'invalid address');
  });
});

// ====================================================================
// TTLCache unit tests
// ====================================================================

const { TTLCache } = require('../lib/cache');

describe('TTLCache', () => {
  it('stores and retrieves values', () => {
    const cache = new TTLCache(60000);
    cache.set('key1', 'value1');
    assert.strictEqual(cache.get('key1'), 'value1');
  });

  it('returns undefined for missing keys', () => {
    const cache = new TTLCache(60000);
    assert.strictEqual(cache.get('missing'), undefined);
  });

  it('expires entries after TTL', async () => {
    const cache = new TTLCache(50); // 50ms TTL
    cache.set('key1', 'value1');
    assert.strictEqual(cache.get('key1'), 'value1');
    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.strictEqual(cache.get('key1'), undefined);
  });

  it('has() returns true for valid entries and false for missing/expired', () => {
    const cache = new TTLCache(60000);
    cache.set('key1', 'value1');
    assert.strictEqual(cache.has('key1'), true);
    assert.strictEqual(cache.has('missing'), false);
  });

  it('delete() removes an entry', () => {
    const cache = new TTLCache(60000);
    cache.set('key1', 'value1');
    cache.delete('key1');
    assert.strictEqual(cache.get('key1'), undefined);
  });

  it('clear() removes all entries', () => {
    const cache = new TTLCache(60000);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.strictEqual(cache.size, 2);
    cache.clear();
    assert.strictEqual(cache.size, 0);
  });

  it('evicts oldest entry when at capacity', () => {
    const cache = new TTLCache(60000, 2); // max 2 entries
    cache.set('first', 1);
    cache.set('second', 2);
    cache.set('third', 3); // should evict 'first'
    assert.strictEqual(cache.get('first'), undefined);
    assert.strictEqual(cache.get('second'), 2);
    assert.strictEqual(cache.get('third'), 3);
  });

  it('allows per-entry TTL override', async () => {
    const cache = new TTLCache(60000); // default 60s
    cache.set('short', 'gone', 50); // 50ms override
    cache.set('long', 'stays'); // uses default 60s
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.strictEqual(cache.get('short'), undefined);
    assert.strictEqual(cache.get('long'), 'stays');
  });
});
