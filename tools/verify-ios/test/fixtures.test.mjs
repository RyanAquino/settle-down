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
  assert.deepEqual(await (await upload()).json(), receipt);
  assert.equal(receipt.receipt_items[1].cost, 200); // quantity 2, already a line total
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
