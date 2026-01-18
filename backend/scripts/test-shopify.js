#!/usr/bin/env node
// Test script for Shopify Catalog API
// Usage: node scripts/test-shopify.js [query]

import dotenv from 'dotenv';
dotenv.config();

import { searchProducts, testConnection } from '../services/catalogClient.js';

async function main() {
  const query = process.argv[2] || 'blue denim jacket';

  console.log('='.repeat(50));
  console.log('Shopify Catalog API Test');
  console.log('='.repeat(50));
  console.log();

  // Check credentials
  if (!process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET) {
    console.log('⚠️  Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET');
    console.log('   Add these to your .env file to test the real API');
    console.log();
    console.log('   For now, using mock data...');
    console.log();

    // Import and test mock
    const { searchShopifyCatalog } = await import('../services/shopify.js');
    const result = await searchShopifyCatalog(query, 3);
    console.log('Mock Results:');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('🔑 Credentials found, testing real API...');
  console.log();

  // Test connection
  const connected = await testConnection();

  if (connected) {
    console.log();
    console.log('-'.repeat(50));
    console.log(`Custom Query: "${query}"`);
    console.log('-'.repeat(50));

    const results = await searchProducts(query, 5);
    console.log();
    console.log('Results:');
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch(console.error);
