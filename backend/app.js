const express = require('express');
const { ethers } = require('ethers');
const cors = require('cors');
const redisModule = require('./lib/redis');
const { validateName, validateAddress, normalizeName, STANDARD_TEXT_KEYS, EXTENDED_TEXT_KEYS } = require('./lib/ens');
const { ensCache } = require('./lib/cache');
let redis = redisModule.redis;
let redisConfigured = redisModule.isConfigured;
if (global.__ENSIGHT_TEST_REDIS__) {
  redis = global.__ENSIGHT_TEST_REDIS__.redis;
  redisConfigured = global.__ENSIGHT_TEST_REDIS__.isConfigured;
}

const app = express();

const DEFAULT_SCAMSNIFFER_URL = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json';

// Enable CORS
app.use(cors());
app.use(express.json());

// Request logging (visible in terminal)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Initialize provider - using public Ethereum mainnet RPC
// You can replace this with your own RPC endpoint (Infura, Alchemy, etc.)
// In tests, set global.__ENSIGHT_TEST_PROVIDER__ before requiring app to inject a mock.
let provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL || 'https://eth.llamarpc.com'
);
if (global.__ENSIGHT_TEST_PROVIDER__) {
  provider = global.__ENSIGHT_TEST_PROVIDER__;
}

/**
 * Resolve ENS name to Ethereum address
 * GET /api/ens/resolve/:name
 * Example: /api/ens/resolve/vitalik.eth
 * Supports any valid ENS name (including subdomains and DNS TLDs).
 */
app.get('/api/ens/resolve/:name', async (req, res) => {
  try {
    const { valid, normalized, error } = validateName(req.params.name);
    if (!valid) {
      return res.status(400).json({ error });
    }

    const cacheKey = `resolve:${normalized}`;
    let address = ensCache.get(cacheKey);
    if (address === undefined) {
      address = await provider.resolveName(normalized);
      if (address) ensCache.set(cacheKey, address);
    }

    if (!address) {
      return res.status(404).json({
        error: `ENS name "${normalized}" not found or not resolved`
      });
    }

    res.json({
      name: normalized,
      address,
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to resolve ENS name',
      message: error.message
    });
  }
});

/**
 * Reverse lookup: Get ENS name from Ethereum address
 * GET /api/ens/reverse/:address
 * Example: /api/ens/reverse/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
 */
app.get('/api/ens/reverse/:address', async (req, res) => {
  try {
    const { valid, error } = validateAddress(req.params.address);
    if (!valid) {
      return res.status(400).json({ error });
    }
    const address = req.params.address;

    const cacheKey = `reverse:${address.toLowerCase()}`;
    let cached = ensCache.get(cacheKey);
    let name, isVerified;

    if (cached) {
      name = cached.name;
      isVerified = cached.verified;
    } else {
      name = await provider.lookupAddress(address);

      if (!name) {
        return res.status(404).json({
          error: `No ENS name found for address "${address}"`
        });
      }

      // Verify the reverse resolution
      const verifiedAddress = await provider.resolveName(name);
      isVerified = verifiedAddress?.toLowerCase() === address.toLowerCase();
      ensCache.set(cacheKey, { name, verified: isVerified });
    }

    res.json({
      address,
      name,
      verified: isVerified,
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to perform reverse lookup',
      message: error.message
    });
  }
});

/**
 * Get text record from ENS name
 * GET /api/ens/text/:name/:key
 * Example: /api/ens/text/vitalik.eth/url
 * Common keys: url, email, description, com.twitter, com.github, etc.
 */
app.get('/api/ens/text/:name/:key', async (req, res) => {
  try {
    const { valid, normalized, error } = validateName(req.params.name);
    if (!valid) {
      return res.status(400).json({ error });
    }

    const { key } = req.params;
    const resolver = await provider.getResolver(normalized);

    if (!resolver) {
      return res.status(404).json({
        error: `No resolver found for "${normalized}"`
      });
    }

    const text = await resolver.getText(key);

    if (!text) {
      return res.status(404).json({
        error: `Text record "${key}" not found for "${normalized}"`
      });
    }

    res.json({
      name: normalized,
      key,
      value: text,
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get text record',
      message: error.message
    });
  }
});

/**
 * Get avatar URL from ENS name
 * GET /api/ens/avatar/:name
 * Example: /api/ens/avatar/vitalik.eth
 */
app.get('/api/ens/avatar/:name', async (req, res) => {
  try {
    const { valid, normalized, error } = validateName(req.params.name);
    if (!valid) {
      return res.status(400).json({ error });
    }

    const resolver = await provider.getResolver(normalized);

    if (!resolver) {
      return res.status(404).json({
        error: `No resolver found for "${normalized}"`
      });
    }

    const avatar = await resolver.getAvatar();

    if (!avatar) {
      return res.status(404).json({
        error: `No avatar found for "${normalized}"`
      });
    }

    res.json({
      name: normalized,
      avatar: avatar.url,
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get avatar',
      message: error.message
    });
  }
});

/**
 * Get comprehensive ENS information for a name
 * GET /api/ens/info/:name
 * Example: /api/ens/info/vitalik.eth
 * Returns address, resolver, avatar, and all standard text records.
 */
app.get('/api/ens/info/:name', async (req, res) => {
  try {
    const { valid, normalized, error } = validateName(req.params.name);
    if (!valid) {
      return res.status(400).json({ error });
    }

    const resolver = await provider.getResolver(normalized);
    const address = await provider.resolveName(normalized);

    if (!address) {
      return res.status(404).json({
        error: `ENS name "${normalized}" not found or not resolved`
      });
    }

    const info = {
      name: normalized,
      address,
      resolver: resolver ? resolver.address : null,
    };

    // Get avatar if available
    if (resolver) {
      try {
        const avatar = await resolver.getAvatar();
        info.avatar = avatar ? avatar.url : null;
      } catch (e) {
        info.avatar = null;
      }

      // Fetch all standard text records (including namespaced social keys)
      info.textRecords = {};

      for (const key of STANDARD_TEXT_KEYS) {
        try {
          const value = await resolver.getText(key);
          if (value) {
            info.textRecords[key] = value;
          }
        } catch (e) {
          // Skip if text record doesn't exist
        }
      }
    }

    res.json({
      ...info,
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get ENS info',
      message: error.message
    });
  }
});

/**
 * Get contenthash for an ENS name (IPFS, IPNS, Swarm, Onion, etc.)
 * GET /api/ens/contenthash/:name
 * Example: /api/ens/contenthash/vitalik.eth
 * Returns the raw contenthash bytes and a decoded URI when possible.
 */
app.get('/api/ens/contenthash/:name', async (req, res) => {
  try {
    const { valid, normalized, error } = validateName(req.params.name);
    if (!valid) {
      return res.status(400).json({ error });
    }

    const resolver = await provider.getResolver(normalized);

    if (!resolver) {
      return res.status(404).json({
        error: `No resolver found for "${normalized}"`
      });
    }

    const contenthash = await resolver.getContentHash();

    if (!contenthash) {
      return res.status(404).json({
        error: `No contenthash set for "${normalized}"`
      });
    }

    res.json({
      name: normalized,
      contenthash,
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get contenthash',
      message: error.message
    });
  }
});

/**
 * Get all ENS records for a name (extended text records + contenthash + address).
 * GET /api/ens/records/:name
 * Example: /api/ens/records/vitalik.eth
 * Returns a comprehensive dump of all available ENS records.
 */
app.get('/api/ens/records/:name', async (req, res) => {
  try {
    const { valid, normalized, error } = validateName(req.params.name);
    if (!valid) {
      return res.status(400).json({ error });
    }

    const resolver = await provider.getResolver(normalized);
    const address = await provider.resolveName(normalized);

    if (!resolver && !address) {
      return res.status(404).json({
        error: `ENS name "${normalized}" not found`
      });
    }

    const records = {
      name: normalized,
      address: address || null,
      resolver: resolver ? resolver.address : null,
      contenthash: null,
      avatar: null,
      textRecords: {},
    };

    if (resolver) {
      // Contenthash
      try {
        records.contenthash = await resolver.getContentHash();
      } catch (e) {
        records.contenthash = null;
      }

      // Avatar
      try {
        const avatar = await resolver.getAvatar();
        records.avatar = avatar ? avatar.url : null;
      } catch (e) {
        records.avatar = null;
      }

      // Extended text records — fetch all known keys
      for (const key of EXTENDED_TEXT_KEYS) {
        try {
          const value = await resolver.getText(key);
          if (value) {
            records.textRecords[key] = value;
          }
        } catch (e) {
          // Skip unavailable keys
        }
      }
    }

    res.json({
      ...records,
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get ENS records',
      message: error.message
    });
  }
});

/**
 * Batch ENS resolution — resolve multiple names and/or addresses in a single request.
 * POST /api/ens/batch
 * Body: { names?: string[], addresses?: string[] }
 * Returns: { results: { names: {...}, addresses: {...} }, success: true }
 *
 * Limited to 20 items per array to prevent abuse.
 */
const BATCH_LIMIT = 20;

app.post('/api/ens/batch', async (req, res) => {
  try {
    const { names = [], addresses = [] } = req.body || {};

    if (!Array.isArray(names) || !Array.isArray(addresses)) {
      return res.status(400).json({ error: '"names" and "addresses" must be arrays' });
    }

    if (names.length > BATCH_LIMIT || addresses.length > BATCH_LIMIT) {
      return res.status(400).json({
        error: `Maximum ${BATCH_LIMIT} items per array`
      });
    }

    const results = { names: {}, addresses: {} };

    // Resolve names → addresses
    for (const rawName of names) {
      const { valid, normalized } = validateName(rawName);
      if (!valid) {
        results.names[rawName] = { address: null, error: 'invalid name' };
        continue;
      }
      try {
        const cacheKey = `resolve:${normalized}`;
        let address = ensCache.get(cacheKey);
        if (address === undefined) {
          address = await provider.resolveName(normalized);
          if (address) ensCache.set(cacheKey, address);
        }
        results.names[normalized] = { address: address || null };
      } catch (e) {
        results.names[normalized] = { address: null, error: e.message };
      }
    }

    // Reverse-resolve addresses → names
    for (const addr of addresses) {
      if (!ethers.isAddress(addr)) {
        results.addresses[addr] = { name: null, error: 'invalid address' };
        continue;
      }
      try {
        const cacheKey = `reverse:${addr.toLowerCase()}`;
        let cached = ensCache.get(cacheKey);
        if (cached) {
          results.addresses[addr] = { name: cached.name, verified: cached.verified };
        } else {
          const name = await provider.lookupAddress(addr);
          if (name) {
            const verifiedAddress = await provider.resolveName(name);
            const verified = verifiedAddress?.toLowerCase() === addr.toLowerCase();
            ensCache.set(cacheKey, { name, verified });
            results.addresses[addr] = { name, verified };
          } else {
            results.addresses[addr] = { name: null };
          }
        }
      } catch (e) {
        results.addresses[addr] = { name: null, error: e.message };
      }
    }

    res.json({ results, success: true });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to process batch ENS resolution',
      message: error.message
    });
  }
});

/**
 * ScamSniffer cron: sync address blacklist to Redis
 * GET /api/cron/scamsniffer-sync
 * Requires: Authorization: Bearer <CRON_SECRET>
 */
app.get('/api/cron/scamsniffer-sync', async (req, res) => {
  const auth = req.headers.authorization;
  const CRON_SECRET = process.env.CRON_SECRET;
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!redisConfigured) {
    return res.status(503).json({ error: 'Redis not configured' });
  }
  try {
    const url = process.env.SCAMSNIFFER_JSON_URL || DEFAULT_SCAMSNIFFER_URL;
    const etag = await redis.get('scamsniffer:etag');
    const resp = await fetch(url, {
      headers: etag ? { 'If-None-Match': etag } : {},
    });
    if (resp.status === 304) {
      return res.json({ ok: true, skipped: true, reason: 'not modified' });
    }
    const newEtag = resp.headers.get('etag');
    const data = await resp.json();
    const raw = Array.isArray(data) ? data : (data?.addresses || data?.data || []);
    const addresses = raw
      .filter((a) => typeof a === 'string' && ethers.isAddress(a))
      .map((a) => a.toLowerCase());
    if (addresses.length > 0) {
      await redis.del('scamsniffer:addresses');
      for (const addr of addresses) {
        await redis.sadd('scamsniffer:addresses', addr);
      }
    }
    await redis.set('scamsniffer:lastUpdated', String(Date.now()));
    if (newEtag) await redis.set('scamsniffer:etag', newEtag);
    res.json({ ok: true, count: addresses.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Risk lookup: check if address is in ScamSniffer blacklist
 * GET /api/risk/address/:address
 */
app.get('/api/risk/address/:address', async (req, res) => {
  let address = (req.params.address || '').trim();
  if (!address) return res.status(400).json({ error: 'address required' });
  if (!ethers.isAddress(address)) return res.status(400).json({ error: 'invalid address' });
  address = address.toLowerCase();
  if (!redisConfigured) {
    return res.json({ flagged: false, lastUpdated: null });
  }
  try {
    const flagged = await redis.sismember('scamsniffer:addresses', address);
    const lastUpdated = await redis.get('scamsniffer:lastUpdated');
    res.json({
      flagged: !!flagged,
      lastUpdated: lastUpdated ? Number(lastUpdated) : null,
    });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

/* ====================================================================
 * Knowledge Graph — semantic wallet interaction edges
 *
 * Redis key schema:
 *   graph:node:{address}          → JSON hash (ensName, label, firstSeen, lastSeen, interactionCount)
 *   graph:neighbors:{address}     → SET of neighbor addresses
 *   graph:edge:{from}:{to}        → JSON hash (type, method, count, firstSeen, lastSeen)
 *   graph:edges-of:{address}      → SET of "from:to" edge keys involving this address
 * ==================================================================== */

/**
 * POST /api/graph/interaction — record a wallet interaction edge.
 * Body: { from, to, method, kind, hostname, chainId?, value?, hasData? }
 */
app.post('/api/graph/interaction', async (req, res) => {
  if (!redisConfigured) {
    return res.json({ ok: true, stored: false, reason: 'redis not configured' });
  }
  try {
    const { from, to, method, kind, hostname, chainId, value, hasData } = req.body || {};
    if (!to || (typeof to !== 'string') || !ethers.isAddress(to)) {
      return res.status(400).json({ error: 'valid "to" address required' });
    }
    const fromAddr = (from && typeof from === 'string' && ethers.isAddress(from)) ? from.toLowerCase() : null;
    const toAddr = to.toLowerCase();
    const now = Date.now();

    // Determine semantic edge type
    const edgeType = edgeTypeFromKind(kind, method);

    // Upsert "to" node
    await upsertGraphNode(toAddr, now);

    // Upsert "from" node if present
    if (fromAddr) {
      await upsertGraphNode(fromAddr, now);
    }

    // Upsert edge
    const effectiveFrom = fromAddr || 'unknown';
    const edgeKey = `graph:edge:${effectiveFrom}:${toAddr}`;
    const existingEdge = await redis.get(edgeKey);
    let edgeData;
    if (existingEdge) {
      edgeData = typeof existingEdge === 'string' ? JSON.parse(existingEdge) : existingEdge;
      edgeData.count = (edgeData.count || 0) + 1;
      edgeData.lastSeen = now;
      edgeData.type = edgeType;
      edgeData.method = method || edgeData.method;
    } else {
      edgeData = {
        from: effectiveFrom,
        to: toAddr,
        type: edgeType,
        method: method || '',
        kind: kind || '',
        hostname: hostname || '',
        count: 1,
        firstSeen: now,
        lastSeen: now,
        ...(chainId != null ? { chainId } : {}),
        ...(value != null ? { value } : {}),
        ...(hasData != null ? { hasData } : {}),
      };
    }
    await redis.set(edgeKey, JSON.stringify(edgeData));

    // Track edge membership for both nodes
    await redis.sadd(`graph:edges-of:${toAddr}`, `${effectiveFrom}:${toAddr}`);
    if (fromAddr) {
      await redis.sadd(`graph:edges-of:${fromAddr}`, `${effectiveFrom}:${toAddr}`);
      await redis.sadd(`graph:neighbors:${fromAddr}`, toAddr);
      await redis.sadd(`graph:neighbors:${toAddr}`, fromAddr);
    }

    res.json({ ok: true, stored: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/graph/address/:address — get node info + all edges for an address.
 */
app.get('/api/graph/address/:address', async (req, res) => {
  let address = (req.params.address || '').trim();
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'valid address required' });
  }
  address = address.toLowerCase();

  if (!redisConfigured) {
    return res.json({ node: emptyNode(address), edges: [], riskSummary: { flagged: false, flaggedNeighborCount: 0, totalNeighborCount: 0 } });
  }

  try {
    // Node
    const nodeRaw = await redis.get(`graph:node:${address}`);
    const node = nodeRaw
      ? (typeof nodeRaw === 'string' ? JSON.parse(nodeRaw) : nodeRaw)
      : emptyNode(address);

    // Edges
    const edgeKeys = await smembers(`graph:edges-of:${address}`);
    const edges = [];
    for (const ek of edgeKeys) {
      const raw = await redis.get(`graph:edge:${ek}`);
      if (raw) {
        edges.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
      }
    }

    // Risk summary: is this address flagged, how many neighbors are flagged?
    const flagged = !!(await redis.sismember('scamsniffer:addresses', address));
    const neighbors = await smembers(`graph:neighbors:${address}`);
    let flaggedNeighborCount = 0;
    for (const nb of neighbors) {
      if (await redis.sismember('scamsniffer:addresses', nb)) flaggedNeighborCount++;
    }

    res.json({
      node: { ...node, flagged },
      edges,
      riskSummary: {
        flagged,
        flaggedNeighborCount,
        totalNeighborCount: neighbors.length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/graph/address/:address/neighbors — get all neighbor nodes + edges.
 */
app.get('/api/graph/address/:address/neighbors', async (req, res) => {
  let address = (req.params.address || '').trim();
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'valid address required' });
  }
  address = address.toLowerCase();

  if (!redisConfigured) {
    return res.json({ address, neighbors: [], edges: [] });
  }

  try {
    const neighborAddrs = await smembers(`graph:neighbors:${address}`);
    const neighbors = [];
    for (const nb of neighborAddrs) {
      const raw = await redis.get(`graph:node:${nb}`);
      const node = raw
        ? (typeof raw === 'string' ? JSON.parse(raw) : raw)
        : emptyNode(nb);
      const flagged = !!(await redis.sismember('scamsniffer:addresses', nb));
      neighbors.push({ ...node, flagged });
    }

    // Edges between address and its neighbors
    const edgeKeys = await smembers(`graph:edges-of:${address}`);
    const edges = [];
    for (const ek of edgeKeys) {
      const raw = await redis.get(`graph:edge:${ek}`);
      if (raw) edges.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
    }

    res.json({ address, neighbors, edges });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* --- graph helpers --- */

function edgeTypeFromKind(kind, method) {
  switch (kind) {
    case 'tx': return 'sent_tx';
    case 'sign': return 'signed_for';
    case 'connect': return 'connected';
    case 'chain': return 'chain_switch';
    default:
      if (method && method.startsWith('eth_sendTransaction')) return 'sent_tx';
      if (method && method.startsWith('eth_sign')) return 'signed_for';
      return 'interaction';
  }
}

async function upsertGraphNode(address, now) {
  const key = `graph:node:${address}`;
  const existing = await redis.get(key);
  let node;
  if (existing) {
    node = typeof existing === 'string' ? JSON.parse(existing) : existing;
    node.lastSeen = now;
    node.interactionCount = (node.interactionCount || 0) + 1;
  } else {
    // Try reverse ENS lookup for labeling
    let ensName = null;
    try {
      ensName = await provider.lookupAddress(address);
    } catch { /* ignore */ }
    node = {
      address,
      ensName,
      label: ensName || null,
      firstSeen: now,
      lastSeen: now,
      interactionCount: 1,
    };
  }
  await redis.set(key, JSON.stringify(node));
  return node;
}

function emptyNode(address) {
  return {
    address,
    ensName: null,
    label: null,
    firstSeen: 0,
    lastSeen: 0,
    interactionCount: 0,
    flagged: false,
  };
}

/**
 * smembers helper — redis.smembers may not exist on the stub or may
 * behave differently across Upstash SDK versions.
 */
async function smembers(key) {
  if (typeof redis.smembers === 'function') {
    return (await redis.smembers(key)) || [];
  }
  // Fallback: not available on stub
  return [];
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ENS Demo Backend',
    timestamp: new Date().toISOString()
  });
});

/**
 * Root endpoint with API documentation
 */
app.get('/', (req, res) => {
  res.json({
    service: 'ENS Demo Backend',
    version: '1.0.0',
    endpoints: {
      'GET /health': 'Health check',
      'GET /api/ens/resolve/:name': 'Resolve ENS name to address (e.g., vitalik.eth)',
      'GET /api/ens/reverse/:address': 'Reverse lookup: Get ENS name from address',
      'GET /api/ens/text/:name/:key': 'Get text record (e.g., /api/ens/text/vitalik.eth/com.twitter)',
      'GET /api/ens/avatar/:name': 'Get avatar URL for ENS name',
      'GET /api/ens/info/:name': 'Get comprehensive ENS information',
      'GET /api/ens/contenthash/:name': 'Get contenthash (IPFS/IPNS/Swarm) for ENS name',
      'GET /api/ens/records/:name': 'Get all ENS records (extended text, contenthash, avatar)',
      'POST /api/ens/batch': 'Batch resolve names and/or addresses (max 20 each)',
      'GET /api/risk/address/:address': 'Check if address is flagged (ScamSniffer)',
      'GET /api/cron/scamsniffer-sync': 'Cron: sync ScamSniffer blacklist (Bearer CRON_SECRET)',
      'POST /api/graph/interaction': 'Record a wallet interaction edge',
      'GET /api/graph/address/:address': 'Get graph node + edges + risk summary',
      'GET /api/graph/address/:address/neighbors': 'Get neighbors + edges for address'
    },
    examples: {
      resolve: '/api/ens/resolve/vitalik.eth',
      reverse: '/api/ens/reverse/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      text: '/api/ens/text/vitalik.eth/com.twitter',
      avatar: '/api/ens/avatar/vitalik.eth',
      info: '/api/ens/info/vitalik.eth',
      contenthash: '/api/ens/contenthash/vitalik.eth',
      records: '/api/ens/records/vitalik.eth',
      risk: '/api/risk/address/0x...',
      graph: '/api/graph/address/0x...'
    }
  });
});

module.exports = app;
