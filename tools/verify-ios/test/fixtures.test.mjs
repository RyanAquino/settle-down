import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixtures, receipt } from '../fixtures.mjs';
import { receiptPng } from '../receipt-image.mjs';

test('synthetic API covers app contracts, errors, request evidence and reset', async (t) => {
  const token = 'test-control-token';
  const server = await startFixtures({ port: 0, token });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://localhost:${server.address().port}`;
  const control = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const reset = (preset) =>
    fetch(`${base}/__reset`, {
      method: 'POST',
      headers: control,
      body: JSON.stringify({ preset, phase: 'test' }),
    });
  assert.equal((await fetch(`${base}/__requests`)).status, 403);
  const groups = await (await fetch(`${base}/api/v1/settle-up/groups/`)).json();
  assert.equal(groups.count, 3);
  assert.equal(groups.items[0].currency, 'JPY');
  const users = await (await fetch(`${base}/api/v1/settle-up/users/?group_id=ci-jpy`)).json();
  assert.equal(users.items[0].id, 'ci-alex');
  const upload = async () => {
    const body = new FormData();
    body.append('file', new Blob([receiptPng()], { type: 'image/png' }), 'receipt.png');
    return fetch(`${base}/api/v1/receipts/receipt-items/`, { method: 'POST', body });
  };
  const scanned = await (await upload()).json();
  assert.deepEqual(scanned, receipt);
  assert.deepEqual(
    scanned.receipt_items.map(({ cost, discount }) => [cost, discount]),
    [
      [100, 0],
      [200, 30], // Paid line total for two Onigiri, after savings.
    ],
  );
  const transaction = {
    group_id: 'ci-jpy',
    paying_member_id: 'ci-alex',
    total_amount: 330,
    user_receipt_items: [{ member_id: 'ci-alex', cost: 100 }],
    split_receipt_items: [200],
  };
  const submit = () =>
    fetch(`${base}/api/v1/settle-up/transactions/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(transaction),
    });
  assert.equal((await submit()).status, 201);
  let requests = await (await fetch(`${base}/__requests`, { headers: control })).json();
  assert.deepEqual(requests.at(-1).body, transaction);
  assert.equal((await reset('production')).status, 400);
  await reset('sync-error');
  requests = await (await fetch(`${base}/__requests`, { headers: control })).json();
  assert.deepEqual(requests, []);
  assert.equal((await submit()).status, 503);
  await reset('upload-error');
  assert.equal((await upload()).status, 503);
  assert.equal((await reset('scan-mismatch-once')).status, 200);
  const mismatch = { ...receipt, total_amount: 410 };
  const readScan = async () => {
    const response = await upload();
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual(await readScan(), mismatch);
  assert.deepEqual(await readScan(), receipt);
  assert.equal((await reset('missing-discount')).status, 200);
  const [juice, onigiri] = (await readScan()).receipt_items;
  assert.equal(Object.hasOwn(juice, 'discount'), false);
  assert.deepEqual({ ...juice, discount: 0 }, receipt.receipt_items[0]);
  assert.deepEqual(onigiri, receipt.receipt_items[1]);
  assert.equal((await reset('success')).status, 200);
  assert.deepEqual(await readScan(), receipt);
  assert.equal((await reset('scan-mismatch-once')).status, 200);
  assert.deepEqual(await readScan(), mismatch);
  assert.equal((await reset('scan-mismatch')).status, 200);
  assert.deepEqual(await readScan(), mismatch);
  assert.deepEqual(await readScan(), mismatch);
  await reset('groups-error');
  assert.equal((await fetch(`${base}/api/v1/settle-up/groups/`)).status, 503);
  await reset('users-error');
  assert.equal((await fetch(`${base}/api/v1/settle-up/users/?group_id=ci-jpy`)).status, 503);
  await reset('no-groups');
  assert.equal((await (await fetch(`${base}/api/v1/settle-up/groups/`)).json()).count, 0);
  assert.equal((await fetch(`${base}/unknown`)).status, 404);
});
test('fixture image is a deterministic PNG', () => {
  const image = receiptPng();
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 480);
  assert.deepEqual(image, receiptPng());
});

test('out-of-order members holds Taiwan until Hong Kong replies and clears pending requests on reset', async (t) => {
  const token = 'test-control-token';
  const server = await startFixtures({ port: 0, token });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const reset = (preset) =>
    fetch(`${base}/__reset`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ preset, phase: 'group-test' }),
    });
  const users = (group) => fetch(`${base}/api/v1/settle-up/users/?group_id=ci-${group}`);
  const startTaiwan = async () => {
    const pending = users('twd');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const requests = await (await fetch(`${base}/__requests`, { headers })).json();
      if (requests.some((r) => r.query === '?group_id=ci-twd')) return { pending };
    }
    throw new Error('Taiwan request did not arrive');
  };
  assert.equal((await reset('out-of-order-members')).status, 200);
  assert.equal((await (await users('jpy')).json()).count, 3);
  assert.equal((await users('hkd')).status, 409);
  const { pending } = await startTaiwan();
  assert.deepEqual(
    (await (await users('hkd')).json()).items.map((m) => m.id),
    ['ci-alex'],
  );
  assert.deepEqual(
    (await (await pending).json()).items.map((m) => m.id),
    ['ci-sam'],
  );
  assert.equal((await users('hkd')).status, 409);
  await reset('out-of-order-members');
  const next = await startTaiwan();
  await reset('success');
  assert.equal((await next.pending).status, 409);
  assert.equal((await (await users('twd')).json()).count, 2);
});
