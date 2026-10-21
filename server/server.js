// The API for the dashboard: a small Node server with no extra dependencies.
//
// It keeps the same REST routes JSON Server had (GET/POST/PATCH/PUT/DELETE on
// /camps, /inventory, /needs, /dispatches, /donations, /volunteers), so the
// brief's "mock API over HTTP" still holds. It adds what JSON Server cannot do:
//
//   /api/...              the same routes under an /api prefix, so the app's pages
//                         (/camps) and the data (/api/camps) never collide when
//                         one service serves both.
//   POST /login          { username, password } -> { token, user }. Every other
//                         data route needs "Authorization: Bearer <token>", and
//                         each account's role decides what it may do.
//   POST /actions/:name   runs one of the app's actions (createDispatch,
//                         markDelivered, createDonation, ...) on the server.
//
// Every request runs one at a time, and an action either completes fully or
// leaves the data exactly as it was. That removes the race between two people
// acting at the same moment, and half-finished writes.
//
// When the app has been built (npm run build), this server also serves the
// built files from dist/, so one service hosts the app and the API.
//
// Data lives in db.json. Run `npm run seed` to reset it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ApiError } from '../src/api/client.js';
import { COLLECTIONS } from '../src/logic/constants.js';
import { createActions, RuleError } from '../src/logic/actions.js';
import { ACTION_CAPABILITY, can } from '../src/logic/permissions.js';
import { createAuth } from './auth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB = path.join(ROOT, 'db.json');
export const DEFAULT_STATIC = path.join(ROOT, 'dist');
export const USERS_FILE = path.join(ROOT, 'server', 'users.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const clone = (value) => structuredClone(value);
const notFound = () => new ApiError('That record no longer exists.', 404);

// ---------- Store: db.json in memory, one operation at a time ----------

export function createStore(file = DEFAULT_DB) {
  const mtimeOf = () => {
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  };
  const load = () => {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const c of COLLECTIONS) raw[c] ??= [];
    return raw;
  };

  let db = load();
  let seenMtime = mtimeOf();
  let tail = Promise.resolve();

  const save = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, file);
    seenMtime = mtimeOf();
  };

  // `npm run seed` rewrites the file while the server runs: pick that up.
  const syncFromDisk = () => {
    if (mtimeOf() !== seenMtime) {
      db = load();
      seenMtime = mtimeOf();
    }
  };

  const rows = (collection) => {
    if (!COLLECTIONS.includes(collection)) throw notFound();
    return db[collection];
  };

  // The same shape the app's API client has, but working on the data in memory.
  const api = {
    baseUrl: 'in-process',
    async list(collection) {
      return clone(rows(collection));
    },
    async get(collection, id) {
      const row = rows(collection).find((r) => r.id === Number(id));
      if (!row) throw notFound();
      return clone(row);
    },
    async create(collection, data) {
      const list = rows(collection);
      const row = { ...data, id: list.reduce((max, r) => Math.max(max, r.id), 0) + 1 };
      list.push(row);
      return clone(row);
    },
    async patch(collection, id, data) {
      const list = rows(collection);
      const index = list.findIndex((r) => r.id === Number(id));
      if (index === -1) throw notFound();
      list[index] = { ...list[index], ...data, id: list[index].id };
      return clone(list[index]);
    },
    async put(collection, id, data) {
      const list = rows(collection);
      const index = list.findIndex((r) => r.id === Number(id));
      if (index === -1) throw notFound();
      list[index] = { ...data, id: list[index].id };
      return clone(list[index]);
    },
    async remove(collection, id) {
      const list = rows(collection);
      const index = list.findIndex((r) => r.id === Number(id));
      if (index === -1) throw notFound();
      list.splice(index, 1);
      return {};
    },
    async loadAll() {
      return Object.fromEntries(COLLECTIONS.map((c) => [c, clone(db[c])]));
    },
  };

  const enqueue = (job) => {
    const run = tail.then(job);
    tail = run.catch(() => {});
    return run;
  };

  return {
    // A read: waits its turn, changes nothing.
    query: (fn) =>
      enqueue(async () => {
        syncFromDisk();
        return fn(api);
      }),
    // A write: all or nothing. If anything throws, the data goes back to how
    // it was before and nothing is saved.
    transact: (fn) =>
      enqueue(async () => {
        syncFromDisk();
        const snapshot = clone(db);
        try {
          const result = await fn(api);
          save();
          return result;
        } catch (err) {
          db = snapshot;
          throw err;
        }
      }),
  };
}

// ---------- HTTP ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new ApiError('Request too large.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new ApiError('The request body is not valid JSON.', 400));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(text);
}

function errorResponse(err) {
  if (err instanceof RuleError) {
    return [422, { error: { type: 'RuleError', message: err.message, fields: err.fields } }];
  }
  if (err instanceof ApiError) {
    const status = err.status || 500;
    return [status, { error: { type: status === 404 ? 'NotFound' : 'BadRequest', message: err.message } }];
  }
  console.error(err);
  return [500, { error: { type: 'ServerError', message: 'Something went wrong on the server.' } }];
}

// Equality filters like /needs?camp_id=3, as JSON Server allowed.
function applyFilters(list, params) {
  let result = list;
  for (const [key, value] of params) {
    if (key.startsWith('_')) continue;
    result = result.filter((row) => String(row[key]) === value);
  }
  return result;
}

// Serves a built file, or null when the path is not a file inside staticDir.
function staticFile(staticDir, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const target = path.resolve(staticDir, `.${rel}`);
  if (!target.startsWith(staticDir + path.sep)) return null; // never leave dist/
  try {
    return fs.statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

function sendFile(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  const hashed = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
  return undefined;
}

const clientAddress = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
const denied = (message = 'Your role is not allowed to do that.') => [403, { error: { type: 'Forbidden', message } }];

// `auth` switches sign-in on. The real server always passes it; leaving it out
// (as some tests do) leaves the data routes open.
export function createServer(store, { log = false, staticDir = null, auth = null } = {}) {
  const pages = staticDir && fs.existsSync(path.join(staticDir, 'index.html')) ? path.resolve(staticDir) : null;

  return http.createServer(async (req, res) => {
    const started = Date.now();
    let status = 500;
    const reply = (code, body) => {
      status = code;
      send(res, code, body);
    };

    try {
      if (req.method === 'OPTIONS') return reply(204);

      const url = new URL(req.url, 'http://localhost');
      let pathname = url.pathname;
      const prefixed = pathname === '/api' || pathname.startsWith('/api/');
      if (prefixed) pathname = pathname.slice(4) || '/';

      // The built app: real files first, then index.html for page loads such as
      // /camps/3, so refreshing a page works. Everything else is the API.
      if (pages && !prefixed && (req.method === 'GET' || req.method === 'HEAD')) {
        const file = staticFile(pages, pathname);
        if (file) {
          status = 200;
          return sendFile(req, res, file);
        }
        if ((req.headers.accept || '').includes('text/html')) {
          status = 200;
          return sendFile(req, res, path.join(pages, 'index.html'));
        }
      }

      const [first, second, third] = pathname.split('/').filter(Boolean);
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : undefined;

      if (first === 'login') {
        if (!auth) return reply(404, {});
        if (req.method !== 'POST') return reply(405, {});
        const result = await auth.login(body?.username, body?.password, clientAddress(req));
        if (result.status !== 200) {
          return reply(result.status, { error: { type: result.status === 429 ? 'TooManyAttempts' : 'Unauthorized', message: result.message } });
        }
        return reply(200, { token: result.token, user: result.user });
      }

      if (first === undefined && req.method === 'GET') {
        return reply(200, {
          name: 'Kinara Relief API',
          resources: COLLECTIONS,
          actions: 'POST /actions/:name with { "args": [...] }',
        });
      }

      // Everything below needs a signed-in user.
      const session = auth ? auth.authenticate(req) : null;
      if (auth && !session) return reply(401, { error: { type: 'Unauthorized', message: 'Your session has ended. Sign in again.' } });
      const deny = () => {
        const [code, payload] = denied();
        return reply(code, payload);
      };

      if (first === 'actions') {
        if (req.method !== 'POST' || !second) return reply(405, { error: { type: 'BadRequest', message: 'Use POST /actions/:name.' } });
        if (auth && !(ACTION_CAPABILITY[second] && can(session.role, ACTION_CAPABILITY[second]))) return deny();
        const args = Array.isArray(body?.args) ? body.args : [];
        const result = await store.transact(async (api) => {
          const actions = createActions(api);
          if (!Object.hasOwn(actions, second) || typeof actions[second] !== 'function') throw notFound();
          return actions[second](...args);
        });
        return reply(200, result === undefined ? null : result);
      }

      if (!COLLECTIONS.includes(first)) return reply(404, {});
      if (auth && req.method !== 'GET' && !can(session.role, 'api.write')) return deny();

      if (second === undefined) {
        if (req.method === 'GET') return reply(200, await store.query(async (api) => applyFilters(await api.list(first), url.searchParams)));
        if (req.method === 'POST') return reply(201, await store.transact((api) => api.create(first, body ?? {})));
      } else if (third === undefined) {
        if (req.method === 'GET') return reply(200, await store.query((api) => api.get(first, second)));
        if (req.method === 'PATCH') return reply(200, await store.transact((api) => api.patch(first, second, body ?? {})));
        if (req.method === 'PUT') return reply(200, await store.transact((api) => api.put(first, second, body ?? {})));
        if (req.method === 'DELETE') return reply(200, await store.transact((api) => api.remove(first, second)));
      }
      return reply(405, {});
    } catch (err) {
      const [code, payload] = errorResponse(err);
      reply(code, payload);
    } finally {
      if (log) console.log(`${req.method} ${req.url} ${status} ${Date.now() - started}ms`);
    }
  });
}

// ---------- Start when run directly: node server/server.js ----------

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (runDirectly) {
  const port = Number(process.env.PORT) || 3001;
  if (!fs.existsSync(USERS_FILE)) {
    console.error('No accounts found. Create one first, for example:\n  npm run user -- set coordinator "a-strong-password" --name "Your Name" --role coordinator');
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET is not set: people will have to sign in again whenever the server restarts.');
  }
  const auth = createAuth({ usersFile: USERS_FILE });
  const server = createServer(createStore(), { log: process.env.QUIET !== '1', staticDir: DEFAULT_STATIC, auth });
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other API first.` : err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`Kinara Relief API on http://localhost:${port}`);
    console.log(`Data file: ${DEFAULT_DB}`);
    if (fs.existsSync(path.join(DEFAULT_STATIC, 'index.html'))) console.log(`Serving the built app from ${DEFAULT_STATIC}`);
  });
}
