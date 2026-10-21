// Accounts, passwords and sessions for the API.
//
// - Passwords are never stored: only a salted scrypt hash, in server/users.json.
// - Logging in returns a signed token (HMAC-SHA256) that expires after 8 hours.
//   The token names the user; the user's role is looked up again on every request,
//   so removing an account or changing its role takes effect at once.
// - Failed logins are limited per ID and address, so passwords cannot be guessed
//   quickly.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { FIELD_VOLUNTEER, COORDINATOR, roleTitle } from '../src/logic/permissions.js';

const KEYLEN = 64;
const scrypt = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, KEYLEN, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  );

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return { salt: salt.toString('hex'), hash: key.toString('hex') };
}

export async function verifyPassword(password, { salt, hash }) {
  const key = await scrypt(password, Buffer.from(salt, 'hex'));
  const expected = Buffer.from(hash, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export const ROLE_ALIASES = {
  coordinator: COORDINATOR,
  admin: COORDINATOR,
  [COORDINATOR.toLowerCase()]: COORDINATOR,
  volunteer: FIELD_VOLUNTEER,
  [FIELD_VOLUNTEER.toLowerCase()]: FIELD_VOLUNTEER,
};

export const MIN_PASSWORD = 8;

export function readUsers(file) {
  const users = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(users)) throw new Error(`${file} must contain a list of users.`);
  return users;
}

export const publicUser = (u) => ({ username: u.username, name: u.name, role: u.role, title: roleTitle(u.role) });

const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function createAuth({
  usersFile,
  secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  ttlMs = 8 * 60 * 60 * 1000,
  now = () => Date.now(),
  maxFailures = 5,
  maxFailuresPerUser = 20,
  windowMs = 15 * 60 * 1000,
} = {}) {
  let cache = { mtime: -1, users: [] };
  const users = () => {
    const mtime = fs.statSync(usersFile).mtimeMs;
    if (mtime !== cache.mtime) cache = { mtime, users: readUsers(usersFile) };
    return cache.users;
  };
  const find = (username) => users().find((u) => u.username.toLowerCase() === String(username || '').trim().toLowerCase());

  const sign = (payload) => {
    const body = b64(JSON.stringify(payload));
    const mac = crypto.createHmac('sha256', secret).update(body).digest();
    return `${body}.${b64(mac)}`;
  };
  const verify = (token) => {
    const [body, mac] = String(token || '').split('.');
    if (!body || !mac) return null;
    const expected = crypto.createHmac('sha256', secret).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      return payload.exp > now() ? payload : null;
    } catch {
      return null;
    }
  };

  // Failed-login memory: key -> { count, since }
  const failures = new Map();
  const recent = (key) => {
    const entry = failures.get(key);
    if (!entry) return 0;
    if (now() - entry.since > windowMs) {
      failures.delete(key);
      return 0;
    }
    return entry.count;
  };
  const record = (key) => {
    const entry = failures.get(key);
    if (!entry || now() - entry.since > windowMs) failures.set(key, { count: 1, since: now() });
    else entry.count += 1;
  };
  const waitMinutes = (key) => Math.max(1, Math.ceil((windowMs - (now() - (failures.get(key)?.since ?? now()))) / 60000));

  let dummy; // checked when the ID does not exist, so timing does not reveal valid IDs
  const dummyCheck = async (password) => {
    dummy ??= await hashPassword('not-a-real-password');
    await verifyPassword(password, dummy);
  };

  return {
    async login(username, password, address = 'unknown') {
      const id = String(username || '').trim().toLowerCase();
      const byAddress = `${address}|${id}`;
      const byUser = `user|${id}`;
      if (recent(byAddress) >= maxFailures || recent(byUser) >= maxFailuresPerUser) {
        const minutes = waitMinutes(recent(byAddress) >= maxFailures ? byAddress : byUser);
        return { status: 429, message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` };
      }
      const user = typeof password === 'string' ? find(id) : null;
      const ok = user ? await verifyPassword(password, user) : (await dummyCheck(String(password || '')), false);
      if (!ok) {
        record(byAddress);
        record(byUser);
        return { status: 401, message: 'Incorrect ID or password.' };
      }
      failures.delete(byAddress);
      return { status: 200, token: sign({ u: user.username, exp: now() + ttlMs }), user: publicUser(user) };
    },

    // Returns the signed-in user for a request, or null.
    authenticate(req) {
      const header = req.headers.authorization || '';
      const payload = header.startsWith('Bearer ') ? verify(header.slice(7)) : null;
      const user = payload ? find(payload.u) : null;
      return user ? publicUser(user) : null;
    },
  };
}
