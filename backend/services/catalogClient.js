// Shopify Catalog API Client
// Uses OAuth2 client_credentials grant with token caching

import dotenv from 'dotenv';
dotenv.config();

const TOKEN_URL = 'https://api.shopify.com/auth/access_token';
const MCP_ENDPOINT = 'https://discover.shopifyapps.com/global/mcp';

// In-memory token cache
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Get a valid access token, refreshing if necessary
 */
async function getAccessToken() {
  const now = Date.now();

  // Return cached token if still valid (with 60s buffer)
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60000) {
    console.log('[Shopify] Using cached token');
    return tokenCache.accessToken;
  }

  console.log('[Shopify] Fetching new access token...');

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are required');
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token request failed: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Cache the token (default 1 hour if not specified)
  const expiresIn = data.expires_in || 3600;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + (expiresIn * 1000),
  };

  console.log(`[Shopify] Token obtained, expires in ${expiresIn}s`);

  return tokenCache.accessToken;
}

/**
 * Execute an MCP tool on the Shopify Catalog API
 */
async function executeMcpTool(toolName, input) {
  const token = await getAccessToken();

  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: input,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`MCP request failed: ${response.status} - ${error}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(`MCP error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  return result.result;
}

/**
 * Search for products in the global Shopify catalog
 * @param {string} query - Search query
 * @param {number} limit - Maximum number of results (default: 5)
 * @returns {Promise<Array>} Normalized product objects
 */
export async function searchProducts(query, limit = 5) {
  console.log(`[Shopify] Searching: "${query}" (limit: ${limit})`);

  try {
    const result = await executeMcpTool('search_global_products', {
      query,
      context: '',
      limit,
    });

    // Parse the result content
    const content = result?.content?.[0];
    if (!content || content.type !== 'text') {
      console.log('[Shopify] No results found');
      return [];
    }

    let parsed;
    try {
      parsed = JSON.parse(content.text);
    } catch (error) {
      console.warn('[Shopify] Failed to parse MCP text payload');
      console.warn('[Shopify] Raw content text:', content.text);
      throw error;
    }
    const products = normalizeProductsPayload(parsed);

    if (!Array.isArray(products)) {
      console.warn('[Shopify] Unexpected products payload shape');
      return [];
    }

    // Normalize product objects
    const normalized = products.map(normalizeProduct);

    console.log(`[Shopify] Found ${normalized.length} products`);

    return normalized;
  } catch (error) {
    console.error(`[Shopify] Search error:`, error.message);
    throw error;
  }
}

/**
 * Normalize products payloads to an array.
 */
function normalizeProductsPayload(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.products)) return parsed.products;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  if (parsed && Array.isArray(parsed.results)) return parsed.results;
  if (parsed && Array.isArray(parsed.offers)) return parsed.offers;
  return [];
}

/**
 * Normalize a product from the Shopify API response
 */
function normalizeProduct(product) {
  if (product && product.id && product.title && product.variants) {
    return normalizeOffer(product);
  }
  return {
    title: product.title || product.name || 'Unknown Product',
    image_url: product.image_url || product.featured_image || product.images?.[0] || null,
    min_price: parsePrice(product.min_price || product.price || product.variants?.[0]?.price),
    max_price: parsePrice(product.max_price || product.price || product.variants?.[0]?.price),
    product_url: product.product_url || product.url || product.handle || null,
    vendor: product.vendor || product.brand || null,
    id: product.id || product.product_id || null,
  };
}

function normalizeOffer(offer) {
  const firstVariant = offer.variants?.[0];
  const firstMedia = offer.media?.[0];
  const minPrice = offer.priceRange?.min?.amount ?? firstVariant?.price?.amount;
  const maxPrice = offer.priceRange?.max?.amount ?? firstVariant?.price?.amount;

  return {
    title: offer.title || offer.displayName || 'Unknown Product',
    image_url: firstMedia?.url || firstVariant?.media?.[0]?.url || null,
    min_price: parsePrice(minPrice),
    max_price: parsePrice(maxPrice),
    product_url: firstVariant?.variantUrl || offer.lookupUrl || null,
    vendor: firstVariant?.shop?.name || null,
    id: offer.id || firstVariant?.id || null,
  };
}

/**
 * Parse price to a consistent format
 */
function parsePrice(price) {
  if (price === null || price === undefined) return null;
  if (typeof price === 'number') return price.toFixed(2);
  if (typeof price === 'string') {
    const num = parseFloat(price.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? null : num.toFixed(2);
  }
  return null;
}

/**
 * Clear the token cache (useful for testing)
 */
export function clearTokenCache() {
  tokenCache = { accessToken: null, expiresAt: 0 };
}

/**
 * Test the connection and search
 */
export async function testConnection() {
  console.log('[Shopify] Testing connection...');
  try {
    const results = await searchProducts('black tee white logo', 3);
    console.log('[Shopify] Connection test successful!');
    console.log('[Shopify] Sample results:', JSON.stringify(results, null, 2));
    return true;
  } catch (error) {
    console.error('[Shopify] Connection test failed:', error.message);
    return false;
  }
}
