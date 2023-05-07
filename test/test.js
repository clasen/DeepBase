/* eslint-env mocha */

const DeepBase = require('../index');
const assert = require('assert');

describe('DeepBase', () => {
    let db;

    beforeEach(() => {
        db = new DeepBase({ name: 'test', path: __dirname });
    });

    afterEach(async () => {
        await db.del(); // delete the test database file
    });

    describe('#set()', () => {
        it('should set a value at a given path', () => {
            db.set('foo', 'bar', 'baz');
            assert.deepEqual(db.get('foo', 'bar'), 'baz');
        });

        it('should overwrite an existing value at the same path', () => {
            db.set('foo', 'bar', 'baz');
            db.set('foo', 'bar', 'qux');
            assert.deepEqual(db.get('foo', 'bar'), 'qux');
        });

        it('should do nothing if no value is provided', () => {
            db.set('foo', 'bar');
            db.set('foo', 'bar', undefined);
            assert.deepEqual(db.get('foo', 'bar'), undefined);
        });

        it('should save changes to disk', async () => {
            await db.set('foo', 'bar', 'baz');
            db = new DeepBase({ name: 'test', path: __dirname }); // create a new instance to reload the saved data
            assert.deepEqual(db.get('foo', 'bar'), 'baz');
        });
    });

    describe('#get()', () => {
        it('should retrieve a value at a given path', () => {
            db.set('foo', 'bar', 'baz');
            assert.deepEqual(db.get('foo', 'bar'), 'baz');
        });

        it('should return null if the value does not exist', () => {
            assert.deepEqual(db.get('foo', 'bar'), null);
        });

        it('should return the entire database if no keys are provided', () => {
            db.set('foo', 'bar', 'baz');
            db.set('qux', 'quux', 'corge');
            assert.deepEqual(db.get(), { foo: { bar: 'baz' }, qux: { quux: 'corge' } });
        });
    });

    describe('#del()', () => {
        it('should delete a value at a given path', () => {
            db.set('foo', 'bar', 'baz');
            db.del('foo', 'bar');
            assert.deepEqual(db.get('foo', 'bar'), null);
        });

        it('should do nothing if the value does not exist', () => {
            db.del('foo', 'bar');
            assert.deepEqual(db.get('foo', 'bar'), null);
        });

        it('should delete the entire database if no keys are provided', () => {
            db.set('foo', 'bar', 'baz');
            db.set('qux', 'quux', 'corge');
            db.del();
            assert.deepEqual(db.get(), {});
        });

        it('should save changes to disk', () => {
            db.set('foo', 'bar', 'baz');
            db.del('foo', 'bar');
            db = new DeepBase({ name: 'test', path: __dirname }); // create a new instance to reload the saved data
            assert.deepEqual(db.get('foo', 'bar'), null);
        });
    });

    describe('#add()', () => {

        it('should save changes to disk', () => {
            const obj = { bar: 'baz' }
            const path = db.add('foo', obj);
            assert.deepEqual(db.get(...path), obj);
        });
    });

    describe('#inc()', () => {

        it('should increment a value at a given path', () => {
            db.set('foo', 'bar', 1);
            db.inc('foo', 'bar', 2);
            assert.deepEqual(db.get('foo', 'bar'), 3);
        });
    });

    describe('#dec()', () => {

        it('should set the value to -1 if it does not exist', () => {
            db.dec('foo', 'bar', 2);
            assert.deepEqual(db.get('foo', 'bar'), -2);
        });

        it('should save changes to disk', async () => {
            await db.set('foo', 'bar', 3);
            await db.dec('foo', 'bar', 2);
            db = new DeepBase({ name: 'test', path: __dirname }); // create a new instance to reload the saved data
            assert.deepEqual(db.get('foo', 'bar'), 1);
        });
    });

    describe('#keys()', () => {

        it('should return keys', async () => {
            db.set('foo', 'bar', 1);
            db.set('foo', 'quux', 1);
            assert.deepEqual(db.keys('foo'), ['bar', 'quux']);
        });
    });
});