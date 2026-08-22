export class UpstreamServiceError extends Error {
  constructor(message, { code = "UPSTREAM_ERROR", statusCode = 503, cause } = {}) {
    super(message, { cause });
    this.name = "UpstreamServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.publicMessage = message;
  }
}

export function getErrorStatus(error) {
  return Number(error?.status || error?.statusCode || error?.response?.status || error?.cause?.status || 0);
}

export function isTransientError(error) {
  const status = getErrorStatus(error);
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  return error?.code === "UPSTREAM_TIMEOUT" || status === 429 || status >= 500 || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(code);
}

export function isQuotaError(error) {
  return getErrorStatus(error) === 429 || /quota|rate limit|resource exhausted/i.test(String(error?.message || ""));
}

export function withTimeout(operation, timeoutMs, message = "Upstream request timed out.") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamServiceError(message, { code: "UPSTREAM_TIMEOUT", statusCode: 504 })), timeoutMs);
  });

  return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => clearTimeout(timer));
}

export async function withRetry(operation, {
  label = "upstream request",
  timeoutMs = 30000,
  maxAttempts = 3,
  baseDelayMs = 250,
  maxDelayMs = 2000,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  logger = console,
} = {}) {
  const startedAt = Date.now();
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await withTimeout(operation, timeoutMs);
      logger.info?.(`[upstream] ${label} succeeded in ${Date.now() - startedAt}ms (attempt ${attempt})`);
      return result;
    } catch (error) {
      const retryable = isTransientError(error) && attempt < maxAttempts;
      if (!retryable) {
        const quota = isQuotaError(error);
        const wrapped = error instanceof UpstreamServiceError ? error : new UpstreamServiceError(
          quota ? "Upstream provider quota exceeded." : `Upstream ${label} failed.`,
          { code: quota ? "UPSTREAM_QUOTA" : "UPSTREAM_ERROR", statusCode: quota ? 429 : 503, cause: error },
        );
        logger.error?.(`[upstream] ${label} failed in ${Date.now() - startedAt}ms (attempt ${attempt}, code ${wrapped.code})`);
        throw wrapped;
      }

      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      logger.warn?.(`[upstream] ${label} transient failure; retrying in ${delay}ms (attempt ${attempt})`);
      await sleep(delay);
    }
  }

  throw new UpstreamServiceError(`Upstream ${label} failed.`, { code: "UPSTREAM_ERROR" });
}

export function createTtlCache({ ttlMs = 60000, maxEntries = 100, now = () => Date.now() } = {}) {
  const entries = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value) {
    entries.delete(key);
    entries.set(key, { value, expiresAt: now() + ttlMs });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  return { get, set, clear: () => entries.clear(), size: () => entries.size };
}

export function createSingleFlightCache({ cache = createTtlCache(), keyFor = (value) => value } = {}) {
  const pending = new Map();

  return {
    async getOrCreate(value, factory) {
      const key = keyFor(value);
      const cached = await cache.get(key);
      if (cached !== undefined) return cached;
      if (pending.has(key)) return pending.get(key);

      const promise = Promise.resolve().then(factory).then(async (result) => {
        await cache.set(key, result);
        return result;
      }).finally(() => pending.delete(key));
      pending.set(key, promise);
      return promise;
    },
    clear: () => { pending.clear(); cache.clear(); },
  };
}
