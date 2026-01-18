import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { analyzeImage } from './services/gemini.js';
import { track } from './analytics/amplitude.js';
import {
  applyBoostsToResults,
  getBoostScores,
  logBoosts,
  recordClick,
  recordImpressions,
} from './analytics/boost.js';
import { connectMongo } from './db/mongo.js';
import { Session } from './models/Session.js';
import { Event } from './models/Event.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration - allow all origins for development
// This is needed because:
// 1. Content scripts run in the context of the web page (youtube.com)
// 2. Background scripts run in chrome-extension:// context
// 3. Errors can bypass the cors middleware, so we need permissive settings
app.use(cors({
  origin: true, // Allow all origins
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Ensure CORS headers are set even on errors
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use(express.json());

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// POST /health
app.post('/health', (req, res) => {
  res.json({ ok: true });
});

// POST /shop-frame - accepts multipart/form-data with "frame" field
app.post('/shop-frame', upload.single('frame'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No image file provided'
    });
  }

  const userId = req.headers['x-anonymous-id'] || req.headers['x-user-id'] || 'anonymous';
  const cacheCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const requestId = crypto.randomUUID();

  track('frame_captured', userId, {
    image_size_bytes: req.file.size,
    mime_type: req.file.mimetype,
  });

  try {
    const boosts = await getBoostScores().catch((error) => {
      console.error('[Boosts] Failed to load boosts:', error);
      return { categoryBoosts: {}, queryBoosts: {}, boostsByKey: {} };
    });
    logBoosts(boosts);

    const imageBuffer = await fs.promises.readFile(req.file.path);
    const frameHash = crypto
      .createHash('sha256')
      .update(imageBuffer)
      .digest('hex');
    const cachedSession = await Session.findOne({
      frameHash,
      createdAt: { $gte: cacheCutoff },
    }).sort({ createdAt: -1 });

    if (cachedSession) {
      console.log(`[Cache] hit for frameHash=${frameHash}`);
      track('cache_hit', userId, { frameHash });

      const boostedResult = applyBoostsToResults(
        { frameItems: cachedSession.items || [], results: cachedSession.results || [] },
        boosts
      );

      recordImpressions({
        userId,
        requestId,
        frameItems: boostedResult.frameItems,
        results: boostedResult.results,
      }).catch((error) => {
        console.error('[Boosts] Failed to record impressions:', error);
      });

      // Clean up uploaded file after processing
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Failed to delete temp file:', err);
      });

      return res.json({
        frameItems: boostedResult.frameItems || [],
        results: boostedResult.results || [],
        sessionId: cachedSession.sessionId,
        frameHash: cachedSession.frameHash,
        requestId,
        cached: true,
      });
    }

    track('cache_miss', userId, { frameHash });

    const sessionId = crypto.randomUUID();
    const result = await analyzeImage(req.file.path);
    const timestampSec = Number(req.body?.timestampSec);
    const sessionPayload = {
      sessionId,
      videoId: req.body?.videoId ? String(req.body.videoId) : undefined,
      timestampSec: Number.isFinite(timestampSec) ? timestampSec : undefined,
      frameHash,
      items: result.frameItems || [],
      results: result.results || [],
    };

    Session.create(sessionPayload).catch((error) => {
      console.error('[MongoDB] Failed to store session:', error);
    });

    const boostedResult = applyBoostsToResults(result, boosts);

    recordImpressions({
      userId,
      requestId,
      frameItems: boostedResult.frameItems,
      results: boostedResult.results,
    }).catch((error) => {
      console.error('[Boosts] Failed to record impressions:', error);
    });

    track('items_detected', userId, {
      items_detected_count: result.frameItems?.length || 0,
    });

    track('catalog_results_shown', userId, {
      results_count: result.results?.length || 0,
    });

    // Clean up uploaded file after processing
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Failed to delete temp file:', err);
    });

    res.json({
      ...boostedResult,
      sessionId,
      frameHash,
      requestId,
    });
  } catch (error) {
    // Clean up on error
    fs.unlink(req.file.path, () => {});

    track('error_occurred', userId, {
      error_message: error.message || 'Failed to analyze image',
      error_stage: 'shop-frame',
    });

    console.error('Gemini analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze image'
    });
  }
});

// POST /track - accepts JSON for server-side tracking (e.g., product clicks)
app.post('/track', (req, res) => {
  const { eventName, userId, eventProps, userProps } = req.body || {};

  if (!eventName) {
    return res.status(400).json({ ok: false, error: 'eventName is required' });
  }

  if (eventName === 'product_clicked') {
    recordClick({
      userId,
      requestId: eventProps?.requestId,
      category: eventProps?.category,
      query: eventProps?.query,
      productId: eventProps?.productId,
      productUrl: eventProps?.productUrl,
    }).catch((error) => {
      console.error('[Boosts] Failed to record click:', error);
    });
  }

  track(eventName, userId, eventProps, userProps);
  res.json({ ok: true });
});

// GET /insights - lightweight analytics for merchants (last 7 days)
app.get('/insights', async (req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const limit = 10;

  try {
    const [
      topDetectedCategories,
      topClickedCategories,
      topItemQueries,
      ctrByCategory,
      latencyStats,
    ] = await Promise.all([
      Event.aggregate([
        { $match: { type: 'item_impression', createdAt: { $gte: since }, itemCategory: { $exists: true, $ne: null } } },
        { $group: { _id: '$itemCategory', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]),
      Event.aggregate([
        { $match: { type: 'product_click', createdAt: { $gte: since }, itemCategory: { $exists: true, $ne: null } } },
        { $group: { _id: '$itemCategory', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]),
      Session.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $unwind: '$results' },
        { $match: { 'results.item.query': { $exists: true, $ne: '' } } },
        { $group: { _id: '$results.item.query', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]),
      Event.aggregate([
        { $match: { createdAt: { $gte: since }, itemCategory: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: '$itemCategory',
            impressions: { $sum: { $cond: [{ $eq: ['$type', 'item_impression'] }, 1, 0] } },
            clicks: { $sum: { $cond: [{ $eq: ['$type', 'product_click'] }, 1, 0] } },
          },
        },
        {
          $project: {
            _id: 0,
            category: '$_id',
            impressions: 1,
            clicks: 1,
            ctr: {
              $cond: [
                { $gt: ['$impressions', 0] },
                { $divide: ['$clicks', '$impressions'] },
                0,
              ],
            },
          },
        },
        { $sort: { ctr: -1 } },
        { $limit: limit },
      ]),
      Event.aggregate([
        { $match: { type: 'shop_frame_latency', createdAt: { $gte: since }, latencyMs: { $type: 'number' } } },
        {
          $group: {
            _id: null,
            p50: { $percentile: { input: '$latencyMs', p: [0.5], method: 'approximate' } },
            p95: { $percentile: { input: '$latencyMs', p: [0.95], method: 'approximate' } },
          },
        },
        {
          $project: {
            _id: 0,
            p50: { $arrayElemAt: ['$p50', 0] },
            p95: { $arrayElemAt: ['$p95', 0] },
          },
        },
      ]),
    ]);

    res.json({
      windowDays: 7,
      topDetectedCategories: topDetectedCategories.map((entry) => ({
        category: entry._id,
        count: entry.count,
      })),
      topClickedCategories: topClickedCategories.map((entry) => ({
        category: entry._id,
        count: entry.count,
      })),
      topItemQueries: topItemQueries.map((entry) => ({
        query: entry._id,
        count: entry.count,
      })),
      ctrByCategory,
      latencyStats: latencyStats[0] || { p50: null, p95: null },
    });
  } catch (error) {
    console.error('Insights error:', error);
    res.status(500).json({ ok: false, error: 'Failed to load insights' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Ensure CORS headers are set on error responses
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  console.error('Server error:', err);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }

  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

connectMongo()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
