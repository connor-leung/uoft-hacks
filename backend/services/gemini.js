import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { searchShopifyCatalog } from './shopify.js';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Function declaration for Gemini function calling
const SEARCH_TOOL = {
  name: 'searchShopifyCatalog',
  description: 'Search the Shopify product catalog for purchasable items. Call this function for each distinct product you identify in the image. Make 5-8 calls total for different items.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'A detailed, search-optimized product query. Include specific attributes like color, material, style, and brand (if visible). Example: "navy blue crew neck cashmere sweater" or "black leather crossbody bag with gold hardware"',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of products to return (1-5). Default is 3.',
      },
    },
    required: ['query'],
  },
};

const AGENT_PROMPT = `You are a shopping assistant that helps users find and purchase items they see in YouTube videos.

Analyze this video screenshot carefully. Your task is to:
1. Identify 5-8 distinct purchasable items visible in the image
2. For EACH item, call the searchShopifyCatalog function with a detailed search query

RULES FOR IDENTIFYING ITEMS:
- Only identify physical products that can be purchased
- Include specific details: color, material, pattern, style when clearly visible
- Only include brand names if a logo or text is CLEARLY visible
- Prioritize prominent, clearly visible items
- Ignore: people's faces, backgrounds, UI elements, non-purchasable items

RULES FOR SEARCH QUERIES:
- Be specific and descriptive (e.g., "distressed light wash high waisted mom jeans" not "jeans")
- Include color, material, style attributes when visible
- Optimize for ecommerce search engines
- Avoid generic words like "nice", "cool", "item"

Make exactly 5-8 function calls, one for each distinct item you identify.`;

export async function analyzeImageWithFunctionCalling(imagePath) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{ functionDeclarations: [SEARCH_TOOL] }],
  });

  const imageData = fs.readFileSync(imagePath);
  const base64Image = imageData.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'image/jpeg';

  console.log('[Gemini] Starting image analysis with function calling...');

  // Initial request with image
  const result = await model.generateContent([
    AGENT_PROMPT,
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
  ]);

  const response = result.response;
  const functionCalls = extractFunctionCalls(response);

  console.log(`[Gemini] Received ${functionCalls.length} function calls`);

  // Execute all function calls in parallel
  const searchResults = await Promise.all(
    functionCalls.slice(0, 8).map(async (call) => {
      const { query, limit = 3 } = call.args;
      try {
        return await searchShopifyCatalog(query, limit);
      } catch (error) {
        console.error(`[Gemini] Search failed for "${query}":`, error.message);
        return { query, products: [] };
      }
    })
  );

  // Aggregate all products, removing duplicates by URL
  const seenUrls = new Set();
  const allProducts = [];

  for (const result of searchResults) {
    for (const product of result.products) {
      if (!seenUrls.has(product.url)) {
        seenUrls.add(product.url);
        allProducts.push({
          ...product,
          searchQuery: result.query,
        });
      }
    }
  }

  console.log(`[Gemini] Returning ${allProducts.length} unique products`);

  return {
    products: allProducts,
    searches: searchResults.map(r => ({
      query: r.query,
      count: r.products.length,
    })),
  };
}

function extractFunctionCalls(response) {
  const calls = [];

  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.functionCall) {
        calls.push({
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }
  }

  return calls;
}

// Keep the old function for backwards compatibility
export async function analyzeImage(imagePath) {
  return analyzeImageWithFunctionCalling(imagePath);
}
