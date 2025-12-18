// Example 1: Simple JSON driver usage
import DeepBase from '../packages/core/src/index.js';

async function main() {
  console.log('🌳 DeepBase Example 1: Simple JSON Driver\n');
  
  // Create a DeepBase with JSON driver (now built-in!)
  // Option 1: Using the backward-compatible syntax
  const db = new DeepBase({ 
    name: 'example1', 
    path: './data' 
  });
  
  await db.connect();
  console.log('✅ Connected to JSON driver\n');
  
  // Set some data
  await db.set('config', 'lang', 'en');
  await db.set('config', 'theme', 'dark');
  console.log('📝 Set config data');
  
  // Add users
  const user1Path = await db.add('users', { name: 'Alice', age: 30 });
  const user2Path = await db.add('users', { name: 'Bob', age: 25 });
  console.log('👤 Added users:', user1Path, user2Path);
  
  // Increment balance
  await db.set(...user1Path, 'balance', 100);
  await db.inc(...user1Path, 'balance', 50);
  console.log('💰 Incremented balance');
  
  // Get data
  const config = await db.get('config');
  const users = await db.get('users');
  
  console.log('\n📊 Final data:');
  console.log('Config:', config);
  console.log('Users:', users);
  
  await db.disconnect();
  console.log('\n✅ Disconnected');
}

main().catch(console.error);

