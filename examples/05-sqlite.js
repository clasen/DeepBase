// Example 5: SQLite driver usage
import DeepBase from '../packages/core/src/index.js';
import { resolvePath } from '../packages/core/src/path.js';
import SqliteDriver from '../packages/driver-sqlite/src/index.js';

const dataPath = resolvePath(import.meta.url, './data');

async function main() {
  console.log('🌳 DeepBase Example 5: SQLite Driver\n');

  // Create a DeepBase with SQLite driver
  const db = new DeepBase(new SqliteDriver({
    name: 'example5',
    path: dataPath
  }));

  await db.connect();
  console.log('✅ Connected to SQLite driver\n');

  // Set some data
  // await db.set('config', { lang: 'en', theme: 'dark' });
  await db.set('config', 'theme', 'light');
  console.log('📝 Set config data');

  console.log(await db.get('config'));

  await db.disconnect();
  console.log('\n✅ Disconnected - Data persisted to SQLite database file');
}

main().catch(console.error);

