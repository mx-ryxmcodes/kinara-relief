// An in-memory stand-in for JSON Server: same routes, same status codes for
// the calls the app makes. Used so tests need no running API.
import { buildSeed } from '../../server/seed.js';
import { createApi } from '../../src/api/client.js';

export const ACCOUNTS = {
  coordinator: { password: 'coord-pass', user: { username: 'coordinator', name: 'Dr. Sana Memon', role: 'Relief Coordinator', title: 'Relief Coordinator (Admin)' } },
  volunteer: { password: 'vol-pass', user: { username: 'volunteer', name: 'Bilal Chandio', role: 'Field Volunteer', title: 'Field Volunteer' } },
};

export function createFakeServer(initial = buildSeed()) {
  const db = structuredClone(initial);
  const calls = [];
  let failNext = null;

  const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  });

  async function fetchImpl(url, opts = {}) {
    const method = opts.method || 'GET';
    const path = new URL(url).pathname;
    calls.push(`${method} ${path}`);
    if (failNext && failNext(method, path)) {
      failNext = null;
      return json(500, { error: 'boom' });
    }
    if (method === 'GET' && path === '/') return json(200, { name: 'fake' });
    if (method === 'POST' && path === '/login') {
      const { username, password } = JSON.parse(opts.body);
      const account = ACCOUNTS[username];
      return account && account.password === password
        ? json(200, { token: `token-${username}`, user: account.user })
        : json(401, { error: { type: 'Unauthorized', message: 'Incorrect ID or password.' } });
    }
    const [, collection, rawId] = path.split('/');
    const rows = db[collection];
    if (!rows) return json(404, {});
    const id = rawId === undefined ? undefined : Number(rawId);
    const body = opts.body ? JSON.parse(opts.body) : undefined;

    if (method === 'GET') {
      if (id === undefined) return json(200, structuredClone(rows));
      const row = rows.find((r) => r.id === id);
      return row ? json(200, structuredClone(row)) : json(404, {});
    }
    if (method === 'POST') {
      const next = rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      const row = { ...body, id: next };
      rows.push(row);
      return json(201, structuredClone(row));
    }
    const index = rows.findIndex((r) => r.id === id);
    if (index === -1) return json(404, {});
    if (method === 'PATCH') {
      rows[index] = { ...rows[index], ...body, id };
      return json(200, structuredClone(rows[index]));
    }
    if (method === 'DELETE') {
      rows.splice(index, 1);
      return json(200, {});
    }
    return json(405, {});
  }

  return {
    db,
    calls,
    fetch: fetchImpl,
    api: createApi('http://fake.test', fetchImpl),
    // Make the next matching request fail with a 500.
    failNext(predicate) {
      failNext = predicate;
    },
  };
}
