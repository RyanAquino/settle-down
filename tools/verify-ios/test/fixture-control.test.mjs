import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startFixtures } from '../fixtures.mjs';
import { fixtureControl, FIXTURE_ORIGIN } from '../fixture-control.mjs';

test('control requests reset and read the IPv4-only fixture server', async t => {
  const token = 'test-token';
  const server = await startFixtures({ port: 0, token });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  assert.equal(new URL(FIXTURE_ORIGIN).hostname, '127.0.0.1');
  assert.deepEqual(await fixtureControl('/__reset', { token, port, body: { preset: 'upload-error', phase: 'test' } }), { preset: 'upload-error', phase: 'test' });
  assert.deepEqual(await fixtureControl('/__requests', { token, port }), []);
  await assert.rejects(fixtureControl('/__requests', { token: 'wrong', port }), /Fixture control \/__requests failed: HTTP 403/);
  await assert.rejects(fixtureControl('/__reset', { token, port, body: { preset: 'invalid', phase: 'test' } }), /HTTP 400/);
  await assert.rejects(fixtureControl('/other', { token, port }), /Invalid fixture control route/);
});

test('timeouts and cancellation identify the control operation without exposing credentials', async t => {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const options = { token: 'must-not-leak', port: server.address().port, timeout: 30 };
  await assert.rejects(fixtureControl('/__reset', { ...options, body: { preset: 'success', phase: 'test' } }), error => {
    assert.match(error.message, /Fixture control \/__reset failed/);
    assert.doesNotMatch(error.message, /must-not-leak/);
    return true;
  });
  const controller = new AbortController();
  controller.abort(new Error('Verification cancelled'));
  await assert.rejects(fixtureControl('/__requests', { ...options, signal: controller.signal }), /Fixture control \/__requests failed: Verification cancelled/);
});
