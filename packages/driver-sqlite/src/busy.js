const SQLITE_BUSY = 5;

export function isSqliteBusyError(error) {
  // Extended result codes (SQLITE_BUSY_SNAPSHOT, ...) keep the primary code in the low byte.
  return Number.isInteger(error?.errcode) && (error.errcode & 0xff) === SQLITE_BUSY;
}

function retryDelayMs(attempt, { baseDelayMs, maxDelayMs }) {
  const cap = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  if (cap === 0) return 0;
  return Math.floor(Math.random() * (cap + 1));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withBusyRetry(operation, config) {
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt === config.maxAttempts) {
        throw error;
      }
      await delay(retryDelayMs(attempt, config));
    }
  }

  throw new Error('Unreachable busy retry state');
}
