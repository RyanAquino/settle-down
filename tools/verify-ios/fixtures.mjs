import http from 'node:http';
import { appendFile, readFile } from 'node:fs/promises';
import { PRESETS } from './policy.mjs';

export const receipt = {
  receipt_items: [
    { english_name: 'Cranberry juice', japanese_name: 'クランベリー', item_order: 1, cost: 100, quantity: 1, discount: 0 },
    { english_name: 'Onigiri', japanese_name: 'おにぎり', item_order: 2, cost: 200, quantity: 2, discount: 0 },
  ],
  en_shop_name: 'CI Receipt Shop', jp_shop_name: 'テスト店', tax_percentage: 10,
  total_amount: 330, receipt_date: '2026-01-15T12:00:00.000Z',
  receipt_image_url: 'http://localhost:8765/receipt.png',
};
export const groups = [
  { id: 'ci-jpy', name: 'CI Japan', currency: 'JPY' },
  { id: 'ci-twd', name: 'CI Taiwan', currency: 'TWD' },
  { id: 'ci-hkd', name: 'CI Hong Kong', currency: 'HKD' },
];
export const members = [{ id: 'ci-alex', name: 'Alex Test' }, { id: 'ci-sam', name: 'Sam Test' }];

export async function startFixtures({ port = 8765, token, logPath, imagePath }) {
  if (!token) throw new Error('Fixture control token is required');
  let preset = 'success';
  let phase = 'exploration';
  const records = [];
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 15 * 1024 * 1024) return send(413, { error: 'Body too large' });
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/__')) {
        if (req.headers.authorization !== `Bearer ${token}`) return send(403, { error: 'Forbidden' });
        if (url.pathname === '/__reset' && req.method === 'POST') {
          const input = JSON.parse(body);
          if (!PRESETS.includes(input.preset) || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.phase)) return send(400, { error: 'Invalid preset/phase' });
          preset = input.preset;
          phase = input.phase;
          records.length = 0;
          return send(200, { preset, phase });
        }
        if (url.pathname === '/__requests' && req.method === 'GET') return send(200, records);
        return send(404, { error: 'Unknown control route' });
      }
      const record = { phase, preset, method: req.method, path: url.pathname, query: url.search, bytes };
      if (req.headers['content-type']?.includes('application/json') && body.length) record.body = JSON.parse(body);
      records.push(record);
      if (logPath) await appendFile(logPath, `${JSON.stringify(record)}\n`);
      if (url.pathname === '/health' && req.method === 'GET') return send(200, { ok: true });
      if (url.pathname === '/receipt.png' && req.method === 'GET' && imagePath) {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(await readFile(imagePath));
      }
      if (url.pathname === '/api/v1/receipts/receipt-items/' && req.method === 'POST') {
        if (!req.headers['content-type']?.includes('multipart/form-data') || !body.includes(Buffer.from('name="file"'))) {
          return send(400, { error: 'Expected multipart file' });
        }
        return send(preset === 'upload-error' ? 503 : 200, preset === 'upload-error' ? { error: 'Synthetic upload failure' } : receipt);
      }
      if (url.pathname === '/api/v1/settle-up/groups/' && req.method === 'GET') {
        if (preset === 'groups-error') return send(503, { error: 'Synthetic groups failure' });
        const items = preset === 'no-groups' ? [] : groups;
        return send(200, { items, count: items.length });
      }
      if (url.pathname === '/api/v1/settle-up/users/' && req.method === 'GET') {
        if (!groups.some(g => g.id === url.searchParams.get('group_id'))) return send(400, { error: 'Unknown group' });
        if (preset === 'users-error') return send(503, { error: 'Synthetic members failure' });
        return send(200, { items: members, count: members.length });
      }
      if (url.pathname === '/api/v1/settle-up/transactions/' && req.method === 'POST') {
        const p = record.body;
        if (!p || !groups.some(g => g.id === p.group_id) || !members.some(m => m.id === p.paying_member_id)
          || !Number.isFinite(p.total_amount) || !Array.isArray(p.user_receipt_items) || !Array.isArray(p.split_receipt_items)) {
          return send(400, { error: 'Invalid transaction' });
        }
        return send(preset === 'sync-error' ? 503 : 201, preset === 'sync-error' ? { error: 'Synthetic sync failure' } : { id: 'ci-transaction' });
      }
      send(404, { error: 'Unsupported fixture endpoint' });
    } catch (error) { send(400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
