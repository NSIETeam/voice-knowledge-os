const assert = require('node:assert/strict');
const test = require('node:test');
const { localBase } = require('../loopback');

test('accepts IPv4, localhost, and IPv6 loopback endpoints', () => {
  assert.equal(localBase('http://127.0.0.1:8765/'), 'http://127.0.0.1:8765');
  assert.equal(localBase('http://localhost:8765'), 'http://localhost:8765');
  assert.equal(localBase('http://[::1]:8765'), 'http://[::1]:8765');
});

test('rejects remote, credentialed, or path-prefixed endpoints', () => {
  for (const value of [
    'https://127.0.0.1:8765',
    'http://example.com:8765',
    'http://192.168.1.4:8765',
    'http://user@127.0.0.1:8765',
    'http://127.0.0.1:8765/proxy',
  ]) assert.throws(() => localBase(value));
});
