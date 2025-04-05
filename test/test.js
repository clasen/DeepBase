/* eslint-env mocha */

import DeepBase from '../index.js';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('DeepBase', () => {
    let db;

    beforeEach(() => {
        db = new DeepBase({ name: 'test', path: __dirname });
    });

    afterEach(async () => {
        await db.del(); // delete the test database file
    });

    describe('#set()', async () => {
        it('should set a value at a given path', async () => {
            await db.set('foo', 'bar', 'baz');
            assert.deepEqual(await db.get('foo', 'bar'), 'baz');
        });

        it('should overwrite an existing value at the same path', async () => {
            await db.set('foo', 'bar', 'baz');
            await db.set('foo', 'bar', 'qux');
            assert.deepEqual(await db.get('foo', 'bar'), 'qux');
        });

        it('should do nothing if no value is provided', async () => {
            await db.set('foo', 'bar');
            await db.set('foo', 'bar', undefined);
            assert.deepEqual(await db.get('foo', 'bar'), undefined);
        });

        it('should save changes to disk', async () => {
            await db.set('foo', 'bar', 'baz');
            db = new DeepBase({ name: 'test', path: __dirname }); // create a new instance to reload the saved data
            assert.deepEqual(await db.get('foo', 'bar'), 'baz');
        });
    });

    describe('#get()', () => {
        it('should retrieve a value at a given path', async () => {
            await db.set('foo', 'bar', 'baz');
            assert.deepEqual(await db.get('foo', 'bar'), 'baz');
        });

        it('should return null if the value does not exist', async () => {
            assert.deepEqual(await db.get('foo', 'bar'), null);
        });

        it('should return the entire database if no keys are provided', async () => {
            await db.set('foo', 'bar', 'baz');
            await db.set('qux', 'quux', 'corge');
            assert.deepEqual(await db.get(), { foo: { bar: 'baz' }, qux: { quux: 'corge' } });
        });
    });

    describe('#del()', () => {
        it('should delete a value at a given path', async () => {
            await db.set('foo', 'bar', 'baz');
            await db.del('foo', 'bar');
            assert.deepEqual(await db.get('foo', 'bar'), null);
        });

        it('should do nothing if the value does not exist', async () => {
            await db.del('foo', 'bar');
            assert.deepEqual(await db.get('foo', 'bar'), null);
        });

        it('should delete the entire database if no keys are provided', async () => {
            await db.set('foo', 'bar', 'baz');
            await db.set('qux', 'quux', 'corge');
            await db.del();
            assert.deepEqual(await db.get(), {});
        });

        it('should save changes to disk', async () => {
            await db.set('foo', 'bar', 'baz');
            await db.del('foo', 'bar');
            db = new DeepBase({ name: 'test', path: __dirname }); // create a new instance to reload the saved data
            assert.deepEqual(await db.get('foo', 'bar'), null);
        });
    });

    describe('#add()', () => {

        it('should save changes to disk', async () => {
            const obj = { bar: 'baz' }
            const path = await db.add('foo', obj);
            assert.deepEqual(await db.get(...path), obj);
        });
    });

    describe('#inc()', () => {

        it('should increment a value at a given path', async () => {
            await db.set('foo', 'bar', 1);
            await db.inc('foo', 'bar', 2);
            assert.deepEqual(await db.get('foo', 'bar'), 3);
        });
    });

    describe('#dec()', () => {

        it('should save changes to disk', async () => {
            await db.set('foo', 'bar', 3);
            await db.dec('foo', 'bar', 2);
            db = new DeepBase({ name: 'test', path: __dirname }); // create a new instance to reload the saved data
            assert.deepEqual(await db.get('foo', 'bar'), 1);
        });

        it('should set the value to -1 if it does not exist', async () => {
            await db.dec('foo', 'bar', 2);
            assert.deepEqual(await db.get('foo', 'bar'), -2);
        });
    });

    describe('#keys()', () => {

        it('should return keys', async () => {
            await db.set('foo', 'bar', 1);
            await db.set('foo', 'quux', 1);
            assert.deepEqual(await db.keys('foo'), ['bar', 'quux']);
        });
    });

    describe('#values()', () => {

        it('should return values', async () => {
            await db.set('foo', 'bar', 1);
            await db.set('foo', 'quux', 1);
            assert.deepEqual(await db.values('foo'), [1, 1]);
        });
    });

    describe('#upd()', () => {

        it('should update field keys', async () => {
            await db.set('foo', 'bar', 2);
            await db.upd('foo', 'bar', n => n * 3);
            assert.deepEqual(await db.get('foo', 'bar'), 6);
        });
      
    });
});