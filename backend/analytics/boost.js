import { AnalyticsEvent } from '../models/AnalyticsEvent.js';

const LOOKBACK_DAYS = 30;
const MIN_IMPRESSIONS = 5;
const USE_MONGO = process.env.USE_MONGO !== 'false';

function computeBoost(clicks, impressions) {
  if (!impressions || impressions < MIN_IMPRESSIONS) return 1;
  const ctr = clicks / impressions;
  return 1 + ctr;
}

function buildBoostMap(rows) {
  const boosts = {};
  for (const row of rows) {
    boosts[row._id] = computeBoost(row.clicks, row.impressions);
  }
  return boosts;
}

export async function getBoostScores() {
  if (!USE_MONGO) {
    return { categoryBoosts: {}, queryBoosts: {}, boostsByKey: {} };
  }
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const categoryRows = await AnalyticsEvent.aggregate([
    { $match: { ts: { $gte: since }, category: { $exists: true } } },
    {
      $group: {
        _id: '$category',
        impressions: {
          $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] },
        },
        clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
      },
    },
  ]);

  const queryRows = await AnalyticsEvent.aggregate([
    { $match: { ts: { $gte: since }, query: { $exists: true } } },
    {
      $group: {
        _id: '$query',
        impressions: {
          $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] },
        },
        clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
      },
    },
  ]);

  const categoryBoosts = buildBoostMap(categoryRows);
  const queryBoosts = buildBoostMap(queryRows);
  const boostsByKey = {};

  for (const [key, value] of Object.entries(categoryBoosts)) {
    boostsByKey[`category:${key}`] = value;
  }
  for (const [key, value] of Object.entries(queryBoosts)) {
    boostsByKey[`query:${key}`] = value;
  }

  return { categoryBoosts, queryBoosts, boostsByKey };
}

export function applyBoostsToResults(result, boosts) {
  if (!result || !Array.isArray(result.results)) return result;

  const { categoryBoosts, queryBoosts } = boosts;
  const groups = result.results.map((group, index) => {
    const category = result.frameItems?.[index]?.item || 'unknown';
    const query = group.item?.query || '';
    const categoryBoost = categoryBoosts[category] || 1;
    const queryBoost = queryBoosts[query] || 1;
    const products = Array.isArray(group.products) ? group.products : [];

    const scoredProducts = products.map((product, productIndex) => {
      const baseScore = (products.length - productIndex) / Math.max(products.length, 1);
      return { product, score: baseScore * queryBoost };
    });

    const boostedProducts = scoredProducts
      .sort((a, b) => b.score - a.score)
      .map(entry => entry.product);

    return {
      index,
      category,
      categoryBoost,
      query,
      queryBoost,
      group: {
        ...group,
        products: boostedProducts,
      },
    };
  });

  groups.sort((a, b) => b.categoryBoost - a.categoryBoost);

  return {
    ...result,
    frameItems: groups.map(entry => result.frameItems?.[entry.index]).filter(Boolean),
    results: groups.map(entry => entry.group),
  };
}

export function logBoosts(boosts) {
  const categoryPairs = Object.entries(boosts.categoryBoosts || {}).sort((a, b) => b[1] - a[1]);
  const queryPairs = Object.entries(boosts.queryBoosts || {}).sort((a, b) => b[1] - a[1]);

  if (!categoryPairs.length && !queryPairs.length) {
    console.log('[Boosts] No boost data available yet.');
    return;
  }

  console.log('[Boosts] Category boosts:', categoryPairs.slice(0, 5));
  console.log('[Boosts] Query boosts:', queryPairs.slice(0, 5));
}

export async function recordImpressions({ userId, requestId, frameItems, results }) {
  if (!USE_MONGO) return;
  const docs = [];
  const now = new Date();

  results.forEach((group, index) => {
    const category = frameItems?.[index]?.item || 'unknown';
    const query = group.item?.query || '';
    const products = Array.isArray(group.products) ? group.products : [];

    products.forEach(product => {
      docs.push({
        type: 'impression',
        category,
        query,
        productId: product.id || product.url || 'unknown',
        productUrl: product.url || '',
        userId: userId || 'anonymous',
        requestId,
        ts: now,
      });
    });
  });

  if (docs.length) {
    await AnalyticsEvent.insertMany(docs, { ordered: false });
  }
}

export async function recordClick({ userId, requestId, category, query, productId, productUrl }) {
  if (!USE_MONGO) return;
  await AnalyticsEvent.create({
    type: 'click',
    category,
    query,
    productId: productId || productUrl || 'unknown',
    productUrl: productUrl || '',
    userId: userId || 'anonymous',
    requestId,
    ts: new Date(),
  });
}
