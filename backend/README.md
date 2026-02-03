# ENS Demo Backend

A simple Express.js backend demonstrating Ethereum Name Service (ENS) functionality.

## Features

- ✅ Resolve ENS names to Ethereum addresses
- ✅ Reverse lookup: Get ENS name from Ethereum address
- ✅ Retrieve text records (URL, email, description, etc.)
- ✅ Get avatar URLs from ENS names
- ✅ Comprehensive ENS information endpoint

## Setup

1. Install dependencies:
```bash
npm install
```

2. (Optional) Set a custom RPC URL:
```bash
export RPC_URL="https://your-rpc-endpoint.com"
```

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000`

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
Example: `/api/ens/text/vitalik.eth/url`

Common keys: `url`, `email`, `description`, `twitter`, `github`, `avatar`

Response:
```json
{
  "name": "vitalik.eth",
  "key": "url",
  "value": "https://vitalik.ca/",
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

Response:
```json
{
  "name": "vitalik.eth",
  "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "resolver": "0x...",
  "avatar": "https://...",
  "textRecords": {
    "url": "https://vitalik.ca/",
    "twitter": "@VitalikButerin"
  },
  "success": true
}
```

## Testing

You can test the API using curl:

```bash
# Health check
curl http://localhost:3000/health

# Resolve ENS name
curl http://localhost:3000/api/ens/resolve/vitalik.eth

# Reverse lookup
curl http://localhost:3000/api/ens/reverse/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045

# Get text record
curl http://localhost:3000/api/ens/text/vitalik.eth/url

# Get avatar
curl http://localhost:3000/api/ens/avatar/vitalik.eth

# Get comprehensive info
curl http://localhost:3000/api/ens/info/vitalik.eth
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `RPC_URL`: Ethereum RPC endpoint (default: https://eth.llamarpc.com)

## Dependencies

- **express**: Web framework
- **ethers**: Ethereum library with ENS support
- **cors**: Cross-origin resource sharing

## Notes

- The demo uses a public RPC endpoint by default. For production, use your own RPC provider (Infura, Alchemy, etc.)
- All endpoints work with Ethereum mainnet ENS names
- Some ENS names may not have all text records or avatars configured

