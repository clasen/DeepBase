import DeepBase from '../packages/core/src/index.js';
import RedisDriver from '../packages/driver-redis-json/src/index.js';

const db = new DeepBase(new RedisDriver());

await db.del();

console.log(await db.set('value', { a: 1, b: 1 }));
console.log(await db.set('value', 'a', 2));
console.log(await db.get('value'));

await db.disconnect();
