import pg from 'pg';

const { Pool } = pg;

let pool;

function getDatabaseUrl() {
  return process.env.DATABASE_URL;
}

export async function connectPostgres() {
  if (pool) return pool;

  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL');
  }

  pool = new Pool({
    connectionString,
    ssl: process.env.PGSSL === 'false' ? false : undefined,
  });

  pool.on('error', (error) => {
    console.error('[Postgres] pool error:', error);
  });

  await pool.query('SELECT 1');
  await ensureSchema(pool);

  console.log('[Postgres] connected');
  return pool;
}

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      video_id TEXT,
      timestamp_sec DOUBLE PRECISION,
      frame_hash TEXT NOT NULL,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      results JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_frame_hash ON sessions (frame_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_created_at_desc ON sessions (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_video_timestamp ON sessions (video_id, timestamp_sec);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      session_id TEXT NOT NULL,
      item_query TEXT,
      item_category TEXT,
      product_url TEXT,
      product_rank INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      latency_ms DOUBLE PRECISION
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_events_type_created_at ON events (type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_item_category_created_at ON events (item_category, created_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      category TEXT,
      query TEXT,
      product_id TEXT,
      product_url TEXT,
      user_id TEXT,
      request_id TEXT,
      ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_analytics_events_ts ON analytics_events (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_category ON analytics_events (category);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_query ON analytics_events (query);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_request_id ON analytics_events (request_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_category_query_ts ON analytics_events (category, query, ts DESC);
  `);
}

export function getPostgres() {
  if (!pool) {
    throw new Error('Postgres is not connected. Call connectPostgres() first.');
  }
  return pool;
}
