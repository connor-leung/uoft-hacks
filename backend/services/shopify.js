// Shopify Catalog API service
// TODO: Replace with actual Shopify MCP endpoint

const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL || 'https://your-shopify-mcp-endpoint.com';

export async function searchShopifyCatalog(query, limit = 5) {
  console.log(`[Shopify] Searching: "${query}" (limit: ${limit})`);

  // TODO: Replace with actual Shopify Catalog API call
  // For now, return mock data for demo

  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));

  // Mock products based on query
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
