// Shopify Catalog API service
// Uses catalogClient for real API calls, falls back to mock for demo

import { searchProducts } from './catalogClient.js';

const USE_MOCK = process.env.SHOPIFY_USE_MOCK === 'true' ||
  (!process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET);

export async function searchShopifyCatalog(query, limit = 5) {
  if (USE_MOCK) {
    console.log(`[Shopify] Using mock data (set SHOPIFY_CLIENT_ID/SECRET to use real API)`);
    return searchMock(query, limit);
  }

  try {
    const products = await searchProducts(query, limit);

    // Transform to expected format
    return {
      query,
      products: products.map(p => ({
        id: p.id,
        title: p.title,
        vendor: p.vendor,
        price: p.min_price,
        priceMax: p.max_price,
        image: p.image_url,
        url: p.product_url,
      })),
    };
  } catch (error) {
    console.error(`[Shopify] API error, falling back to mock:`, error.message);
    return searchMock(query, limit);
  }
}

// Mock implementation for demo/development
async function searchMock(query, limit) {
  console.log(`[Shopify] Mock search: "${query}" (limit: ${limit})`);

  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));

  const mockProducts = generateMockProducts(query, limit);

  return {
    query,
    products: mockProducts,
  };
}

function generateMockProducts(query, limit) {
  const words = query.toLowerCase().split(' ');
  const products = [];

  for (let i = 0; i < Math.min(limit, 3); i++) {
    products.push({
      id: `prod_${Date.now()}_${i}`,
      title: `${capitalize(query)} - Style ${i + 1}`,
      vendor: getRandomVendor(),
      price: (Math.random() * 200 + 20).toFixed(2),
      image: `https://via.placeholder.com/300x300/1a1a1a/ffffff?text=${encodeURIComponent(words[0] || 'Product')}`,
      url: `https://example-shop.myshopify.com/products/${words.join('-')}-${i + 1}`,
    });
  }

  return products;
}

function capitalize(str) {
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getRandomVendor() {
  const vendors = ['StyleCo', 'TrendHub', 'ModernWear', 'UrbanFinds', 'LuxeGoods'];
  return vendors[Math.floor(Math.random() * vendors.length)];
}
