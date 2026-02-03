const express = require('express');
const { ethers } = require('ethers');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());

// Initialize provider - using public Ethereum mainnet RPC
// You can replace this with your own RPC endpoint (Infura, Alchemy, etc.)
const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL || 'https://eth.llamarpc.com'
);

/**
 * Resolve ENS name to Ethereum address
 * GET /api/ens/resolve/:name
 * Example: /api/ens/resolve/vitalik.eth
 */
app.get('/api/ens/resolve/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    if (!name || !name.endsWith('.eth')) {
      return res.status(400).json({ 
        error: 'Invalid ENS name. Must end with .eth' 
      });
    }

    const address = await provider.resolveName(name);
    
    if (!address) {
      return res.status(404).json({ 
        error: `ENS name "${name}" not found or not resolved` 
      });
    }

    res.json({
      name,
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
    const { address } = req.params;
    
    // Validate Ethereum address
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ 
        error: 'Invalid Ethereum address' 
      });
    }

    const name = await provider.lookupAddress(address);
    
    if (!name) {
      return res.status(404).json({ 
        error: `No ENS name found for address "${address}"` 
      });
    }

    // Verify the reverse resolution
    const verifiedAddress = await provider.resolveName(name);
    const isVerified = verifiedAddress?.toLowerCase() === address.toLowerCase();

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
 * Common keys: url, email, description, avatar, etc.
 */
app.get('/api/ens/text/:name/:key', async (req, res) => {
  try {
    const { name, key } = req.params;
    
    if (!name || !name.endsWith('.eth')) {
      return res.status(400).json({ 
        error: 'Invalid ENS name. Must end with .eth' 
      });
    }

    const resolver = await provider.getResolver(name);
    
    if (!resolver) {
      return res.status(404).json({ 
        error: `No resolver found for "${name}"` 
      });
    }

    const text = await resolver.getText(key);
    
    if (!text) {
      return res.status(404).json({ 
        error: `Text record "${key}" not found for "${name}"` 
      });
    }

    res.json({
      name,
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
    const { name } = req.params;
    
    if (!name || !name.endsWith('.eth')) {
      return res.status(400).json({ 
        error: 'Invalid ENS name. Must end with .eth' 
      });
    }

    const resolver = await provider.getResolver(name);
    
    if (!resolver) {
      return res.status(404).json({ 
        error: `No resolver found for "${name}"` 
      });
    }

    const avatar = await resolver.getAvatar();
    
    if (!avatar) {
      return res.status(404).json({ 
        error: `No avatar found for "${name}"` 
      });
    }

    res.json({
      name,
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
 */
app.get('/api/ens/info/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    if (!name || !name.endsWith('.eth')) {
      return res.status(400).json({ 
        error: 'Invalid ENS name. Must end with .eth' 
      });
    }

    const resolver = await provider.getResolver(name);
    const address = await provider.resolveName(name);
    
    if (!address) {
      return res.status(404).json({ 
        error: `ENS name "${name}" not found or not resolved` 
      });
    }

    const info = {
      name,
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

      // Get common text records
      const textKeys = ['url', 'email', 'description', 'twitter', 'github'];
      info.textRecords = {};
      
      for (const key of textKeys) {
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
      'GET /api/ens/text/:name/:key': 'Get text record (e.g., /api/ens/text/vitalik.eth/url)',
      'GET /api/ens/avatar/:name': 'Get avatar URL for ENS name',
      'GET /api/ens/info/:name': 'Get comprehensive ENS information'
    },
    examples: {
      resolve: '/api/ens/resolve/vitalik.eth',
      reverse: '/api/ens/reverse/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      text: '/api/ens/text/vitalik.eth/url',
      avatar: '/api/ens/avatar/vitalik.eth',
      info: '/api/ens/info/vitalik.eth'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 ENS Demo Backend running on http://localhost:${PORT}`);
  console.log(`📚 API docs available at http://localhost:${PORT}/`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
});

