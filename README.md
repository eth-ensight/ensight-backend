<p align="center">
  <img src=".github/images/ensight-logo.png" width="180" alt="ENSight Logo" />
</p>

<h1 align="center">ENSight Backend</h1>

<p align="center">
  Intelligence and risk engine for ENSight — decoding wallet intent, enriching on-chain data, and powering real-time safety insights.
</p>

<p align="center">
  <a href="https://ethglobal.com" target="_blank">
    <img src="https://img.shields.io/badge/Community-ETHGlobal-blue" />
  </a>
  <a href="https://ethglobal.com/events/hackmoney2026/" target="_blank">
    <img src="https://img.shields.io/badge/Built%20at-HackMoney%202026-purple" />
  </a>
  <img src="https://img.shields.io/badge/Platform-Backend%20Services-black" />
</p>

---

## 🧠 Intent & Risk Engine

ENSight Backend transforms raw blockchain actions into meaningful, human-readable context.

It is responsible for:

- Decoding transaction calldata & method signatures  
- Enriching interactions with contract metadata  
- Applying risk heuristics & anomaly detection  
- Attaching trust & reputation signals  
- Generating explanation payloads for the extension & web app  

---

## 🔄 Backend Flow

### How it works

1. ENSight Extension intercepts wallet intent  
2. Structured payload is sent to backend  
3. Transaction is decoded & classified  
4. Risk and trust signals are applied  
5. Context is enriched with on-chain data  
6. Explanation response is returned in real time  

---

## ⛓️ On-Chain + Off-Chain Intelligence

### 🔗 On-Chain Data

- Transaction calldata & logs  
- Contract metadata & histories  
- ENS identity resolution  
- Wallet interaction graphs  

### 🧠 Off-Chain Intelligence

- Behavioral risk heuristics  
- Abnormal pattern detection  
- Reputation signals  
- Context interpretation  

Together this powers ENSight’s real-time safety layer.

---

## ⚙️ Tech Stack

- Node.js / TypeScript (or your actual backend stack)  
- Blockchain RPC providers  
- Transaction decoding utilities  
- REST / WebSocket APIs  

---

## 🧱 How ENSight Backend Fits In

```
ENSight Extension
↓
ENSight Backend (intent + risk engine)
↓
ENSight Web (dApp & context views)
↓
Ethereum + ENS
```

---

## 🛠 Project Setup

### Prerequisites

- Node.js 18+  
- npm or pnpm  

### Install and run locally

```bash
git clone https://github.com/eth-ensight/ensight-backend.git
cd ensight-backend/backend
npm install
npm run dev
```

The server runs on `http://localhost:3000`. For **ENS-only** use you do not need any env vars. For **risk lookup** and **ScamSniffer cron** you need Upstash Redis and `CRON_SECRET`; see [backend/README.md](backend/README.md) and copy `backend/.env.example` to `backend/.env`.

### Tests

From `backend/` run `npm test`. Unit tests use mocked RPC and Redis, so no secrets are required.

### Vercel deployment

The repo is structured for Vercel serverless: the Express app lives in `backend/app.js` and is exported from `api/index.js`. Deploy with Vercel; set `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `CRON_SECRET` in the project environment. A daily cron for `/api/cron/scamsniffer-sync` is configured in `vercel.json`; configure the cron to send `Authorization: Bearer <CRON_SECRET>`.

### API overview

- **ENS:** `GET /api/ens/resolve/:name`, `/api/ens/reverse/:address`, `/api/ens/text/:name/:key`, `/api/ens/avatar/:name`, `/api/ens/info/:name`, `/api/ens/contenthash/:name`, `/api/ens/records/:name`, `POST /api/ens/batch`
- **Risk:** `GET /api/risk/address/:address` — returns `{ flagged, lastUpdated }` from ScamSniffer data in Redis
- **Cron:** `GET /api/cron/scamsniffer-sync` (Bearer `CRON_SECRET`) — syncs ScamSniffer blacklist to Redis
- **Graph:** `POST /api/graph/interaction`, `GET /api/graph/address/:address`, `GET /api/graph/address/:address/neighbors`

Full endpoint docs, env vars, and curl examples: [backend/README.md](backend/README.md).

---

## 🔐 Environment Variables

See [backend/README.md](backend/README.md) and `backend/.env.example`. Summary:

- `PORT` (default 3000), `RPC_URL` (optional)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (for risk + cron)
- `CRON_SECRET` (for `/api/cron/scamsniffer-sync`)
- `SCAMSNIFFER_JSON_URL` (optional override)

---

## 🤝 Contributing

🤝 Contributing
Contributions welcome across:
- Transaction decoding improvements
- Risk detection heuristics
- Performance optimizations
- API design
-  On-chain data enrichment

---

<sub>Part of the ENSight ecosystem • Built for open Web3 infrastructure</sub>
