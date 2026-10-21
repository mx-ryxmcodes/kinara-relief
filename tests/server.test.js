import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSeed } from '../server/seed.js';
import { createServer, createStore } from '../server/server.js';
import { createApi } from '../src/api/client.js';
import { createActions, RuleError } from '../src/logic/actions.js';
import { createServerActions } from '../src/logic/serverActions.js';

let dir;
let file;
let server;
let api;
let actions;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relief-api-'));
  file = path.join(dir, 'db.json');
  fs.writeFileSync(file, JSON.stringify(buildSeed()));
  server = createServer(createStore(file));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = createApi(`http://127.0.0.1:${server.address().port}`);
  actions = createServerActions(api, createActions(api));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('REST routes', () => {
  it('lists, creates, patches and deletes, and saves to db.json', async () => {
    expect((await api.list('camps')).length).toBe(8);
    const created = await api.create('camps', { name: 'Test Camp', district: 'Badin', capacity: 10, current_families: 0, status: 'Active' });
    expect(created.id).toBe(9);
    await api.patch('camps', 9, { capacity: 20 });
    expect((await api.get('camps', 9)).capacity).toBe(20);
    expect(onDisk().camps.find((c) => c.id === 9).capacity).toBe(20);
    await api.remove('camps', 9);
    expect(onDisk().camps.length).toBe(8);
  });

  it('answers 404 for a missing record and an unknown collection', async () => {
    await expect(api.get('camps', 999)).rejects.toMatchObject({ status: 404 });
    await expect(api.list('nothing')).rejects.toMatchObject({ status: 404 });
  });

  it('filters by field like JSON Server did', async () => {
    const res = await fetch(`${api.baseUrl}/needs?camp_id=1`);
    const rows = await res.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((n) => n.camp_id === 1)).toBe(true);
  });
});

describe('all-or-nothing writes', () => {
  it('puts everything back if an action fails half way', async () => {
    const store = createStore(file);
    const before = onDisk();
    await expect(
      store.transact(async (db) => {
        await db.patch('camps', 1, { name: 'Changed' });
        await db.create('donations', { type: 'Cash', amount_or_quantity: 1 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await store.query((db) => db.get('camps', 1))).name).toBe(before.camps[0].name);
    expect((await store.query((db) => db.list('donations'))).length).toBe(before.donations.length);
    expect(onDisk()).toEqual(before);
  });

  it('never over-reserves when several dispatches arrive at the same moment', async () => {
    // Need 12 has exactly 50 left to reserve. Five people each ask for 20.
    const reservedOn = async () =>
      (await api.list('dispatches')).filter((d) => d.need_id === 12 && ['Pending', 'In Transit'].includes(d.status)).reduce((sum, d) => sum + d.quantity, 0);
    const before = await reservedOn();
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => actions.createDispatch({ camp_id: 5, need_id: 12, quantity: 20 })),
    );
    const accepted = attempts.filter((a) => a.status === 'fulfilled');
    const refused = attempts.filter((a) => a.status === 'rejected');
    expect(accepted).toHaveLength(2);
    expect(refused.every((r) => r.reason instanceof RuleError)).toBe(true);
    expect((await reservedOn()) - before).toBe(40);
  });
});

describe('actions on the server', () => {
  it('carries rule errors and their fields back to the app', async () => {
    const err = await actions.createCamp({ name: '', district: '', capacity: '', current_families: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(RuleError);
    expect(Object.keys(err.fields).length).toBeGreaterThan(0);
  });

  it('runs a full dispatch from Pending to Delivered', async () => {
    const d = await actions.createDispatch({ camp_id: 5, need_id: 12, quantity: 10 });
    await actions.markInTransit(d.id);
    await actions.markDelivered(d.id);
    expect((await api.get('dispatches', d.id)).status).toBe('Delivered');
    expect((await api.get('needs', 12)).fulfilled_quantity).toBe(160);
  });

  it('picks up a reseed of db.json without a restart', async () => {
    const reset = buildSeed();
    reset.camps = reset.camps.slice(0, 3);
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(file, JSON.stringify(reset));
    expect((await api.list('camps')).length).toBe(3);
  });
});

describe('serving the built app', () => {
  let site;
  let base;
  let assetsDir;

  beforeEach(async () => {
    site = fs.mkdtempSync(path.join(os.tmpdir(), 'relief-site-'));
    assetsDir = path.join(site, 'assets');
    fs.mkdirSync(assetsDir);
    fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><title>Kinara Relief</title>');
    fs.writeFileSync(path.join(assetsDir, 'app.js'), 'console.log(1)');
    await new Promise((resolve) => server.close(resolve));
    server = createServer(createStore(file), { staticDir: site });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => fs.rmSync(site, { recursive: true, force: true }));

  const page = { headers: { Accept: 'text/html,application/xhtml+xml' } };

  it('serves the app at / and for page loads like /camps/3', async () => {
    for (const p of ['/', '/camps', '/camps/3', '/dispatches']) {
      const res = await fetch(base + p, page);
      expect(res.status, p).toBe(200);
      expect(await res.text()).toContain('Kinara Relief');
    }
  });

  it('serves built files with the right type', async () => {
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toBe('console.log(1)');
  });

  it('keeps the API under /api, and still answers data requests at /camps', async () => {
    expect((await (await fetch(`${base}/api/camps`)).json()).length).toBe(8);
    expect((await (await fetch(`${base}/camps`)).json()).length).toBe(8); // not a page load
    expect((await (await fetch(`${base}/api`)).json()).name).toBe('Kinara Relief API');
    const created = await fetch(`${base}/api/camps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Via prefix' }) });
    expect(created.status).toBe(201);
  });

  it('runs actions under /api too', async () => {
    const prefixed = createApi(`${base}/api`);
    const viaPrefix = createServerActions(prefixed, createActions(prefixed));
    const d = await viaPrefix.createDispatch({ camp_id: 5, need_id: 12, quantity: 5 });
    expect(d.status).toBe('Pending');
  });

  it('never serves files from outside the built folder', async () => {
    fs.writeFileSync(path.join(path.dirname(site), 'secret-relief.txt'), 'secret');
    for (const p of ['/..%2fsecret-relief.txt', '/%2e%2e/secret-relief.txt']) {
      const res = await fetch(base + p, page);
      expect(await res.text(), p).not.toContain('secret');
    }
    fs.rmSync(path.join(path.dirname(site), 'secret-relief.txt'), { force: true });
  });
});

describe('sign-in and permissions', () => {
  let secured;
  let url;
  let users;

  const login = (username, password) =>
    fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const tokenFor = async (username, password) => (await (await login(username, password)).json()).token;
  const call = (token, method, route, body) =>
    fetch(`${url}/api${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    });
  const act = (token, name, ...args) => call(token, 'POST', `/actions/${name}`, { args });

  let clock;
  beforeEach(async () => {
    const { hashPassword, createAuth } = await import('../server/auth.js');
    users = path.join(dir, 'users.json');
    fs.writeFileSync(
      users,
      JSON.stringify([
        { username: 'boss', name: 'The Boss', role: 'Relief Coordinator', ...(await hashPassword('boss-password-1')) },
        { username: 'field', name: 'Field Person', role: 'Field Volunteer', ...(await hashPassword('field-password-1')) },
      ]),
    );
    clock = 1_000_000;
    await new Promise((resolve) => server.close(resolve));
    secured = createServer(createStore(file), { auth: createAuth({ usersFile: users, secret: 'test-secret', now: () => clock }) });
    await new Promise((resolve) => secured.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${secured.address().port}`;
    server = secured; // closed by the outer afterEach
  });

  it('refuses every data route without a token', async () => {
    for (const [method, route] of [['GET', '/camps'], ['GET', '/needs'], ['POST', '/camps'], ['POST', '/actions/createCamp'], ['DELETE', '/camps/1']]) {
      expect((await call(null, method, route, {})).status, `${method} ${route}`).toBe(401);
    }
    expect((await fetch(`${url}/api`)).status).toBe(200); // the health check stays public
  });

  it('signs in with the right password and never reveals the hash', async () => {
    const res = await login('boss', 'boss-password-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ username: 'boss', name: 'The Boss', role: 'Relief Coordinator', title: 'Relief Coordinator (Admin)' });
    expect(JSON.stringify(body)).not.toMatch(/hash|salt|password/i);
    expect((await call(body.token, 'GET', '/camps')).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown ID', async () => {
    const wrong = await login('boss', 'nope-nope-nope');
    const unknown = await login('nobody', 'nope-nope-nope');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('rejects forged, tampered and expired tokens', async () => {
    const token = await tokenFor('boss', 'boss-password-1');
    const [body, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'boss', exp: clock + 1e9 })).toString('base64url');
    expect((await call(`${forged}.${mac}`, 'GET', '/camps')).status).toBe(401);
    expect((await call(`${body}.${mac.slice(0, -2)}xx`, 'GET', '/camps')).status).toBe(401);
    expect((await call('garbage', 'GET', '/camps')).status).toBe(401);
    clock += 9 * 60 * 60 * 1000; // past the 8 hour limit
    expect((await call(token, 'GET', '/camps')).status).toBe(401);
  });

  it('locks out guessing after five wrong passwords', async () => {
    for (let i = 0; i < 5; i += 1) expect((await login('boss', `wrong-${i}-wrong`)).status).toBe(401);
    const locked = await login('boss', 'boss-password-1'); // even the right one is refused now
    expect(locked.status).toBe(429);
    expect((await locked.json()).error.message).toMatch(/Try again in/);
    clock += 16 * 60 * 1000;
    expect((await login('boss', 'boss-password-1')).status).toBe(200);
  });

  it('lets a Field Volunteer read, update families and deliver, and nothing else', async () => {
    const field = await tokenFor('field', 'field-password-1');
    expect((await call(field, 'GET', '/camps')).status).toBe(200);
    expect((await act(field, 'updateCampFamilies', 1, 330)).status).toBe(200);
    for (const [name, args] of [
      ['createCamp', [{ name: 'X', district: 'Y', capacity: 5, current_families: 1, status: 'Active' }]],
      ['deleteCamp', [1]],
      ['createDispatch', [{ camp_id: 5, need_id: 12, quantity: 5 }]],
      ['cancelDispatch', [1]],
      ['createDonation', [{ type: 'Cash', amount_or_quantity: 5, category: 'Food' }]],
      ['assignVolunteer', [1, 2]],
      ['deleteItem', [1]],
    ]) {
      expect((await act(field, name, ...args)).status, name).toBe(403);
    }
    expect((await call(field, 'POST', '/camps', { name: 'sneaky' })).status).toBe(403);
    expect((await call(field, 'PATCH', '/inventory/1', { stock: 999999 })).status).toBe(403);
    expect((await call(field, 'DELETE', '/camps/1')).status).toBe(403);
    expect(onDisk().camps.length).toBe(8);
    expect(onDisk().inventory[0].stock).not.toBe(999999);
  });

  it('lets the coordinator do all of it, and refuses unlisted actions for everyone', async () => {
    const boss = await tokenFor('boss', 'boss-password-1');
    expect((await act(boss, 'createDispatch', { camp_id: 5, need_id: 12, quantity: 5 })).status).toBe(200);
    expect((await act(boss, 'launchRocket')).status).toBe(403);
    expect((await act(boss, 'constructor')).status).toBe(403);
  });

  it('stops working the moment an account is removed', async () => {
    const field = await tokenFor('field', 'field-password-1');
    expect((await call(field, 'GET', '/camps')).status).toBe(200);
    fs.writeFileSync(users, JSON.stringify(JSON.parse(fs.readFileSync(users, 'utf8')).filter((u) => u.username !== 'field')));
    await new Promise((r) => setTimeout(r, 20));
    expect((await call(field, 'GET', '/camps')).status).toBe(401);
  });

  it('has a capability for every action the app can run', async () => {
    const { ACTION_CAPABILITY } = await import('../src/logic/permissions.js');
    const names = Object.keys(createActions({}));
    expect(names.filter((n) => !ACTION_CAPABILITY[n])).toEqual([]);
  });
});
