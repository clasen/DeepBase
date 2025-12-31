import { DeepBase } from 'deepbase';

const db = new DeepBase({ name: 'pop-shift-demo' });

async function demo() {
  console.log('🚀 Testing pop() and shift() methods\n');
  
  // Test with add() - more realistic use case
  console.log('📝 Adding 5 items using add():');
  await db.add('items', 1);
  await db.add('items', 2);
  await db.add('items', 3);
  await db.add('items', 4);
  await db.add('items', 5);
  
  let values = await db.values('items');
  console.log('  Values:', values);
  console.log('  Count:', values.length);
  console.log('');
  
  // Test pop() - removes and returns last element
  console.log('🔴 Testing pop():');
  const popped = await db.pop('items');
  console.log('  Popped value:', popped);
  
  values = await db.values('items');
  console.log('  Remaining values:', values);
  console.log('  Count:', values.length);
  console.log('');
  
  // Test shift() - removes and returns first element
  console.log('🔵 Testing shift():');
  const shifted = await db.shift('items');
  console.log('  Shifted value:', shifted);
  
  values = await db.values('items');
  console.log('  Remaining values:', values);
  console.log('  Count:', values.length);
  console.log('');
  
  // Multiple operations
  console.log('🔄 Multiple operations:');
  await db.pop('items');
  console.log('  After pop:', await db.values('items'));
  
  await db.shift('items');
  console.log('  After shift:', await db.values('items'));
  
  await db.pop('items');
  console.log('  After pop:', await db.values('items'));
  console.log('');
  
  // Pop from empty
  console.log('⚠️  Pop from empty:');
  const emptyPop = await db.pop('items');
  console.log('  Result:', emptyPop); // undefined
  console.log('');
  
  // Queue simulation
  console.log('📦 Queue simulation (FIFO with shift):');
  await db.add('queue', 'job1');
  await db.add('queue', 'job2');
  await db.add('queue', 'job3');
  
  console.log('  Initial queue:', await db.values('queue'));
  
  let job = await db.shift('queue');
  console.log('  Processing:', job);
  
  job = await db.shift('queue');
  console.log('  Processing:', job);
  
  console.log('  Remaining:', await db.values('queue'));
  console.log('');
  
  // Stack simulation
  console.log('📚 Stack simulation (LIFO with pop):');
  await db.add('stack', 'page1');
  await db.add('stack', 'page2');
  await db.add('stack', 'page3');
  
  console.log('  Initial stack:', await db.values('stack'));
  
  let page = await db.pop('stack');
  console.log('  Back to:', page);
  
  page = await db.pop('stack');
  console.log('  Back to:', page);
  
  console.log('  Remaining:', await db.values('stack'));
  
  console.log('\n✅ All tests completed!');
}

demo().catch(console.error);

