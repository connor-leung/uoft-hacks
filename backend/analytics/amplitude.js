import * as amplitude from '@amplitude/analytics-node';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

let isInitialized = false;

function ensureInit() {
  if (process.env.USE_AMPLITUDE === 'false') return false;
  if (isInitialized) return true;
  const apiKey = process.env.AMPLITUDE_API_KEY;
  if (!apiKey) return false;
  amplitude.init(apiKey);
  isInitialized = true;
  return true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function track(eventName, userId, eventProps = {}, userProps = undefined) {
  if (!eventName || !ensureInit()) return;

  const normalizedUserId = normalizeId(userId);
  const deviceIdFromProps = normalizeId(eventProps?.device_id);

  const eventProperties = {
    app_env: process.env.APP_ENV || 'development',
    ...eventProps,
  };

  const eventOptions = {};
  if (normalizedUserId) {
    eventOptions.user_id = normalizedUserId;
  } else {
    eventOptions.device_id = deviceIdFromProps || 'anonymous-device';
  }
  if (userProps) {
    eventOptions.user_properties = userProps;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await amplitude.track(eventName, eventProperties, eventOptions);
      await amplitude.flush();
      return;
    } catch (error) {
      // Fail silently; retry on network-like failures only.
    }

    if (attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * (2 ** attempt);
      await sleep(delay);
    }
  }
}

function normalizeId(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (['anonymous', 'unknown', 'null', 'undefined'].includes(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
}
