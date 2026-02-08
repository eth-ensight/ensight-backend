# ENSight Backend

An Express.js backend providing comprehensive Ethereum Name Service (ENS) resolution, wallet risk intelligence, and interaction graph features.

## Features

### ENS Resolution (works without Redis)
- Resolve ENS names to Ethereum addresses (any TLD, subdomains supported)
- Reverse lookup: Get ENS name from Ethereum address
- Retrieve text records (URL, email, social handles with namespaced keys)
- Get avatar URLs from ENS names
- Comprehensive ENS information endpoint
- Contenthash resolution (IPFS, IPNS, Swarm, Onion)
- Full record dump with all extended text keys
- Batch resolution for multiple names/addresses in a single request
- In-memory TTL cache to reduce redundant RPC calls
- Proper ENS name normalization (ENSIP-15 / UTS-46 via `ethers.ensNormalize`)

### Risk & Intelligence (requires Redis)
- Risk lookup: Check if an address is in the ScamSniffer blacklist
- ScamSniffer cron: Sync address blacklist to Redis
- Knowledge graph: Record wallet interaction edges and query nodes/neighbors

## Setup

1. Install dependencies:
```bash
npm install
```

2. (Optional) Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000`.

For **ENS-only** use you do not need any env vars. For **risk lookup**, **cron**, and **knowledge graph** you need Upstash Redis and `CRON_SECRET`.

## API Endpoints

### Health Check
```
GET /health
```

### Resolve ENS Name to Address
```
GET /api/ens/resolve/:name
```
Example: `/api/ens/resolve/vitalik.eth`

Supports any valid ENS name including subdomains (e.g. `sub.name.eth`) and DNS TLDs (e.g. `name.xyz`). Names are normalized using ENSIP-15 / UTS-46. Results are cached for 5 minutes.

Response:
```json
{
  "name": "vitalik.eth",
  "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "success": true
}
```

### Reverse Lookup (Address to ENS Name)
```
GET /api/ens/reverse/:address
```
Example: `/api/ens/reverse/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`

Performs forward verification to confirm the reverse record is authentic. Results are cached.

Response:
```json
{
  "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "name": "vitalik.eth",
  "verified": true,
  "success": true
}
```

### Get Text Record
```
GET /api/ens/text/:name/:key
```
Example: `/api/ens/text/vitalik.eth/com.twitter`

Common keys: `url`, `email`, `description`, `com.twitter`, `com.github`, `com.discord`, `org.telegram`, `avatar`, `name`, `notice`, `keywords`, `location`

Response:
```json
{
  "name": "vitalik.eth",
  "key": "com.twitter",
  "value": "VitalikButerin",
  "success": true
}
```

### Get Avatar URL
```
GET /api/ens/avatar/:name
```
Example: `/api/ens/avatar/vitalik.eth`

Response:
```json
{
  "name": "vitalik.eth",
  "avatar": "https://...",
  "success": true
}
```

### Get Comprehensive ENS Info
```
GET /api/ens/info/:name
```
Example: `/api/ens/info/vitalik.eth`

Returns address, resolver, avatar, and all standard text records (including namespaced social keys like `com.twitter`, `com.github`, `com.discord`, `org.telegram`).

Response:
```json
{
  "name": "vitalik.eth",
  "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "resolver": "0x...",
  "avatar": "https://...",
  "textRecords": {
    "url": "https://vitalik.ca/",
    "com.twitter": "VitalikButerin",
    "com.github": "vbuterin",
    "description": "..."
  },
  "success": true
}
```

### Get Contenthash
```
GET /api/ens/contenthash/:name
```
Example: `/api/ens/contenthash/vitalik.eth`

Returns the contenthash (IPFS, IPNS, Swarm, Onion) associated with the ENS name.

Response:
```json
{
  "name": "vitalik.eth",
  "contenthash": "ipfs://QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4",
  "success": true
}
```

### Get All ENS Records
```
GET /api/ens/records/:name
```
Example: `/api/ens/records/vitalik.eth`

Comprehensive dump of all available ENS records including extended text keys, contenthash, and avatar.

Response:
```json
{
  "name": "vitalik.eth",
  "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "resolver": "0x...",
  "contenthash": "ipfs://...",
  "avatar": "https://...",
  "textRecords": {
    "url": "...",
    "email": "...",
    "com.twitter": "...",
    "com.github": "...",
    "com.discord": "...",
    "org.telegram": "...",
    "eth.ens.delegate": "..."
  },
  "success": true
}
```

### Batch ENS Resolution
```
POST /api/ens/batch
Content-Type: application/json
```

Resolve up to 20 names and 20 addresses in a single request. Uses the same cache layer for consistent performance.

Request body:
```json
{
  "names": ["vitalik.eth", "nick.eth"],
  "addresses": ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]
}
```

Response:
```json
{
  "results": {
    "names": {
      "vitalik.eth": { "address": "0xd8dA..." },
      "nick.eth": { "address": "0x..." }
    },
    "addresses": {
      "0xd8dA...": { "name": "vitalik.eth", "verified": true }
    }
  },
  "success": true
}
```

### Risk Lookup (ScamSniffer)
```
GET /api/risk/address/:address
```
Example: `/api/risk/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`

Requires Redis (Upstash). If Redis is not configured, returns `{ flagged: false, lastUpdated: null }`.

Response:
```json
{
  "flagged": false,
  "lastUpdated": 1234567890123
}
```

### ScamSniffer Cron Sync (protected)
```
GET /api/cron/scamsniffer-sync
Authorization: Bearer <CRON_SECRET>
```
Syncs the ScamSniffer address blacklist from GitHub into Redis. Requires `CRON_SECRET` and Redis. Returns `401` without valid auth, `503` if Redis is not configured.

Response (success): `{ "ok": true, "count": 12345 }`  
Response (304 not modified): `{ "ok": true, "skipped": true, "reason": "not modified" }`

### Knowledge Graph
```
POST /api/graph/interaction      — Record a wallet interaction edge
GET  /api/graph/address/:address — Get graph node + edges + risk summary
GET  /api/graph/address/:address/neighbors — Get neighbors + edges
```

## Testing

### Unit tests (no secrets required)

```bash
npm test
```

Uses mocked RPC and Redis; runs in CI and locally without `.env`. Tests cover:
- ENS utility module (normalization, validation, text key constants)
- All ENS endpoints (resolve, reverse, text, avatar, info, contenthash, records, batch)
- TTL cache (expiry, eviction, per-entry TTL override)
- Risk, cron, and knowledge graph endpoints

### Manual testing with curl

```bash
# Health check
curl http://localhost:3000/health

# Resolve ENS name
curl http://localhost:3000/api/ens/resolve/vitalik.eth

# Reverse lookup
curl http://localhost:3000/api/ens/reverse/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045

# Get text record (namespaced key)
curl http://localhost:3000/api/ens/text/vitalik.eth/com.twitter

# Get avatar
curl http://localhost:3000/api/ens/avatar/vitalik.eth

# Get comprehensive info
curl http://localhost:3000/api/ens/info/vitalik.eth

# Get contenthash
curl http://localhost:3000/api/ens/contenthash/vitalik.eth

# Get all records
curl http://localhost:3000/api/ens/records/vitalik.eth

# Batch resolution
curl -X POST http://localhost:3000/api/ens/batch \
  -H "Content-Type: application/json" \
  -d '{"names": ["vitalik.eth", "nick.eth"], "addresses": ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]}'

# Risk lookup (requires Redis)
curl http://localhost:3000/api/risk/address/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045

# Cron sync (requires CRON_SECRET and Redis)
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/scamsniffer-sync
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `RPC_URL` | No | `https://eth.llamarpc.com` | Ethereum RPC endpoint |
| `UPSTASH_REDIS_REST_URL` | For risk/graph | — | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | For risk/graph | — | Upstash Redis REST token |
| `CRON_SECRET` | For cron | — | Bearer token for cron endpoint |
| `SCAMSNIFFER_JSON_URL` | No | ScamSniffer repo | Override ScamSniffer blacklist URL |

Copy `.env.example` to `.env` and fill in values for local runs.

## Architecture

```
backend/
├── app.js              # Express app with all routes
├── server.js           # Local dev server (app.listen)
├── lib/
│   ├── ens.js          # ENS utilities: normalization, validation, text key constants
│   ├── cache.js        # In-memory TTL cache for ENS lookups
│   └── redis.js        # Upstash Redis client (with no-op stub fallback)
├── test/
│   └── app.test.js     # Comprehensive test suite (55 tests)
└── package.json
```

## Dependencies

- **express**: Web framework
- **ethers**: Ethereum library with ENS support (v6)
- **cors**: Cross-origin resource sharing
- **@upstash/redis**: Redis client for risk lookup and knowledge graph

## Vercel deployment

The app is structured for Vercel serverless: the Express app is in `app.js` and exported from `api/index.js` at the repo root. Local dev uses `server.js` (which calls `app.listen()`). See the root [README](../README.md) for deployment and cron setup.

## Notes

- The backend uses a public RPC endpoint by default. For production, use your own RPC provider (Infura, Alchemy, etc.)
- ENS resolution works with Ethereum mainnet names
- Names are normalized using ENSIP-15 / UTS-46 (supports international characters, subdomains, DNS TLDs)
- ENS lookup results are cached in-memory for 5 minutes (configurable via `TTLCache`)
- Not all ENS names have text records, avatars, or contenthashes configured
- Risk and cron endpoints require Upstash Redis; cron also requires `CRON_SECRET`
