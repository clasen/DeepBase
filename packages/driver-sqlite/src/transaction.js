/**
 * Wrap a function so every call runs inside BEGIN IMMEDIATE ... COMMIT, taking
 * the write lock up front and rolling back when the function throws.
 * @param {import('node:sqlite').DatabaseSync} db - Open connection
 * @param {Function} fn - Synchronous body of the transaction
 * @returns {Function} Transactional version of fn
 */
export function immediateTransaction(db, fn) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  };
}

