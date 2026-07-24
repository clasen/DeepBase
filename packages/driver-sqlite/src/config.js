const PRAGMA_PROFILES = Object.freeze({
  none: null,
  safe: Object.freeze({
    journal_mode: 'WAL',
    synchronous: 'FULL',
    temp_store: 'MEMORY',
    cache_size: -2000,
    mmap_size: 0,
  }),
  balanced: Object.freeze({
    journal_mode: 'WAL',
    synchronous: 'NORMAL',
    temp_store: 'MEMORY',
    cache_size: -8000,
    mmap_size: 268435456,
  }),
  fast: Object.freeze({
    journal_mode: 'WAL',
    synchronous: 'OFF',
    temp_store: 'MEMORY',
    cache_size: -16000,
    mmap_size: 268435456,
  }),
});

export const SQLITE_CONFIG = Object.freeze({
  defaultPragma: 'balanced',
  busyTimeoutMs: 5000,
  busyRetry: Object.freeze({
    maxAttempts: 2,
    baseDelayMs: 25,
    maxDelayMs: 250,
  }),
  pragmaProfiles: PRAGMA_PROFILES,
});

function assertNonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

export function resolveSqliteConfig({ pragma, busyTimeoutMs, busyRetry } = {}) {
  const resolvedPragma = pragma ?? SQLITE_CONFIG.defaultPragma;
  if (!Object.prototype.hasOwnProperty.call(SQLITE_CONFIG.pragmaProfiles, resolvedPragma)) {
    throw new TypeError(`pragma must be one of: ${Object.keys(SQLITE_CONFIG.pragmaProfiles).join(', ')}`);
  }

  const resolvedBusyTimeoutMs = busyTimeoutMs ?? SQLITE_CONFIG.busyTimeoutMs;
  assertNonNegativeInteger('busyTimeoutMs', resolvedBusyTimeoutMs);

  if (busyRetry !== undefined && (busyRetry === null || typeof busyRetry !== 'object' || Array.isArray(busyRetry))) {
    throw new TypeError('busyRetry must be an object');
  }

  const resolvedBusyRetry = {
    ...SQLITE_CONFIG.busyRetry,
    ...(busyRetry ?? {}),
  };
  assertNonNegativeInteger('busyRetry.maxAttempts', resolvedBusyRetry.maxAttempts);
  assertNonNegativeInteger('busyRetry.baseDelayMs', resolvedBusyRetry.baseDelayMs);
  assertNonNegativeInteger('busyRetry.maxDelayMs', resolvedBusyRetry.maxDelayMs);

  if (resolvedBusyRetry.maxAttempts < 1) {
    throw new TypeError('busyRetry.maxAttempts must be at least 1');
  }
  if (resolvedBusyRetry.maxDelayMs < resolvedBusyRetry.baseDelayMs) {
    throw new TypeError('busyRetry.maxDelayMs must be greater than or equal to busyRetry.baseDelayMs');
  }

  return {
    pragma: resolvedPragma,
    pragmaConfig: SQLITE_CONFIG.pragmaProfiles[resolvedPragma],
    busyTimeoutMs: resolvedBusyTimeoutMs,
    busyRetry: resolvedBusyRetry,
  };
}
