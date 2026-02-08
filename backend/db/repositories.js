import { getPostgres } from './postgres.js';

function mapSessionRow(row) {
  return {
    sessionId: row.session_id,
    videoId: row.video_id,
    timestampSec: row.timestamp_sec,
    frameHash: row.frame_hash,
    items: row.items || [],
    results: row.results || [],
    createdAt: row.created_at,
  };
}

export async function findRecentSessionByFrameHash(frameHash, cutoff) {
  const db = getPostgres();
  const { rows } = await db.query(
    `
      SELECT session_id, video_id, timestamp_sec, frame_hash, items, results, created_at
      FROM sessions
      WHERE frame_hash = $1 AND created_at >= $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [frameHash, cutoff]
  );
  return rows[0] ? mapSessionRow(rows[0]) : null;
}

export async function createSession(session) {
  const db = getPostgres();
  await db.query(
    `
      INSERT INTO sessions (session_id, video_id, timestamp_sec, frame_hash, items, results)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
    `,
    [
      session.sessionId,
      session.videoId ?? null,
      session.timestampSec ?? null,
      session.frameHash,
      JSON.stringify(session.items || []),
      JSON.stringify(session.results || []),
    ]
  );
}

export async function listCategoryBoostRows(since) {
  const db = getPostgres();
  const { rows } = await db.query(
    `
      SELECT
        category AS key,
        COUNT(*) FILTER (WHERE type = 'impression') AS impressions,
        COUNT(*) FILTER (WHERE type = 'click') AS clicks
      FROM analytics_events
      WHERE ts >= $1 AND category IS NOT NULL
      GROUP BY category
    `,
    [since]
  );
  return rows;
}

export async function listQueryBoostRows(since) {
  const db = getPostgres();
  const { rows } = await db.query(
    `
      SELECT
        query AS key,
        COUNT(*) FILTER (WHERE type = 'impression') AS impressions,
        COUNT(*) FILTER (WHERE type = 'click') AS clicks
      FROM analytics_events
      WHERE ts >= $1 AND query IS NOT NULL
      GROUP BY query
    `,
    [since]
  );
  return rows;
}

export async function insertAnalyticsImpressions(docs) {
  if (!docs.length) return;

  const db = getPostgres();
  const values = [];
  const placeholders = docs.map((doc, index) => {
    const base = index * 8;
    values.push(
      doc.type,
      doc.category ?? null,
      doc.query ?? null,
      doc.productId ?? null,
      doc.productUrl ?? null,
      doc.userId ?? null,
      doc.requestId ?? null,
      doc.ts
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
  });

  await db.query(
    `
      INSERT INTO analytics_events
        (type, category, query, product_id, product_url, user_id, request_id, ts)
      VALUES ${placeholders.join(', ')}
    `,
    values
  );
}

export async function insertAnalyticsClick(doc) {
  const db = getPostgres();
  await db.query(
    `
      INSERT INTO analytics_events
        (type, category, query, product_id, product_url, user_id, request_id, ts)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      doc.type,
      doc.category ?? null,
      doc.query ?? null,
      doc.productId ?? null,
      doc.productUrl ?? null,
      doc.userId ?? null,
      doc.requestId ?? null,
      doc.ts,
    ]
  );
}

export async function getInsights(since, limit) {
  const db = getPostgres();

  const [
    topDetectedResult,
    topClickedResult,
    topQueriesResult,
    ctrResult,
    latencyResult,
  ] = await Promise.all([
    db.query(
      `
        SELECT item_category AS category, COUNT(*)::int AS count
        FROM events
        WHERE type = 'item_impression'
          AND created_at >= $1
          AND item_category IS NOT NULL
        GROUP BY item_category
        ORDER BY count DESC
        LIMIT $2
      `,
      [since, limit]
    ),
    db.query(
      `
        SELECT item_category AS category, COUNT(*)::int AS count
        FROM events
        WHERE type = 'product_click'
          AND created_at >= $1
          AND item_category IS NOT NULL
        GROUP BY item_category
        ORDER BY count DESC
        LIMIT $2
      `,
      [since, limit]
    ),
    db.query(
      `
        SELECT
          result_item.query AS query,
          COUNT(*)::int AS count
        FROM sessions s
        CROSS JOIN LATERAL jsonb_array_elements(s.results) AS result_group
        CROSS JOIN LATERAL (
          SELECT NULLIF(TRIM(result_group->'item'->>'query'), '') AS query
        ) AS result_item
        WHERE s.created_at >= $1
          AND result_item.query IS NOT NULL
        GROUP BY result_item.query
        ORDER BY count DESC
        LIMIT $2
      `,
      [since, limit]
    ),
    db.query(
      `
        SELECT
          item_category AS category,
          COUNT(*) FILTER (WHERE type = 'item_impression')::int AS impressions,
          COUNT(*) FILTER (WHERE type = 'product_click')::int AS clicks,
          CASE
            WHEN COUNT(*) FILTER (WHERE type = 'item_impression') > 0
            THEN (COUNT(*) FILTER (WHERE type = 'product_click')::double precision
              / COUNT(*) FILTER (WHERE type = 'item_impression')::double precision)
            ELSE 0
          END AS ctr
        FROM events
        WHERE created_at >= $1
          AND item_category IS NOT NULL
        GROUP BY item_category
        ORDER BY ctr DESC
        LIMIT $2
      `,
      [since, limit]
    ),
    db.query(
      `
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
        FROM events
        WHERE type = 'shop_frame_latency'
          AND created_at >= $1
          AND latency_ms IS NOT NULL
      `,
      [since]
    ),
  ]);

  const latency = latencyResult.rows[0] || { p50: null, p95: null };

  return {
    topDetectedCategories: topDetectedResult.rows.map((entry) => ({
      category: entry.category,
      count: Number(entry.count),
    })),
    topClickedCategories: topClickedResult.rows.map((entry) => ({
      category: entry.category,
      count: Number(entry.count),
    })),
    topItemQueries: topQueriesResult.rows.map((entry) => ({
      query: entry.query,
      count: Number(entry.count),
    })),
    ctrByCategory: ctrResult.rows.map((entry) => ({
      category: entry.category,
      impressions: Number(entry.impressions),
      clicks: Number(entry.clicks),
      ctr: Number(entry.ctr),
    })),
    latencyStats: {
      p50: latency.p50 == null ? null : Number(latency.p50),
      p95: latency.p95 == null ? null : Number(latency.p95),
    },
  };
}
