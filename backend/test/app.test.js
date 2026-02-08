'use strict';

const { describe, it } = require('node:test');
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
  getResolver: async () => ({
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
  }),
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
