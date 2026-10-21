// Thin HTTP client for the API (server/server.js, or JSON Server). Every read and write in the app
// goes through here. To move to another backend later, only this file changes.
import { COLLECTIONS } from '../logic/constants.js';
import { readSession } from './session.js';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const DEFAULT_API_URL = 'http://localhost:3001';

export const UNAUTHORIZED_EVENT = 'relief:unauthorized';

export function createApi(baseUrl = DEFAULT_API_URL, fetchImpl = (...args) => fetch(...args), { getToken = () => readSession()?.token } = {}) {
  const root = baseUrl.replace(/\/+$/, '');

  async function request(method, path, body, { auth = true } = {}) {
    let res;
    const token = auth ? getToken() : null;
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      res = await fetchImpl(`${root}${path}`, {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Cannot connect to the server right now. Check your internet connection and try again in a moment.');
    }
    if (!res.ok) {
      // Our own server explains itself in the body: { error: { type, message, fields } }.
      let detail = null;
      try {
        const text = await res.text();
        detail = text ? JSON.parse(text)?.error ?? null : null;
      } catch {
        detail = null;
      }
      const err = new ApiError(
        detail?.message || (res.status === 404 ? 'That record no longer exists.' : `The API returned an error (${res.status}).`),
        res.status,
      );
      if (res.status === 401 && auth && typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      err.handled = Boolean(detail?.type); // true when our server answered, not a plain JSON Server
      if (detail?.type === 'RuleError') err.rule = { message: detail.message, fields: detail.fields || {} };
      throw err;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    baseUrl: root,
    list: (collection) => request('GET', `/${collection}`),
    get: (collection, id) => request('GET', `/${collection}/${id}`),
    create: (collection, data) => request('POST', `/${collection}`, data),
    patch: (collection, id, data) => request('PATCH', `/${collection}/${id}`, data),
    remove: (collection, id) => request('DELETE', `/${collection}/${id}`),
    login: (username, password) => request('POST', '/login', { username, password }, { auth: false }),
    // True when the API answers at all (no sign-in needed).
    async ping() {
      try {
        return (await fetchImpl(`${root}/`)).ok;
      } catch {
        return false;
      }
    },
    // Runs an action on the server, all or nothing (see server/server.js).
    callAction: (name, args = []) => request('POST', `/actions/${name}`, { args }),
    async loadAll() {
      const lists = await Promise.all(COLLECTIONS.map((c) => request('GET', `/${c}`)));
      return Object.fromEntries(COLLECTIONS.map((c, i) => [c, lists[i]]));
    },
  };
}

// In development the API is on its own port. In a production build the app is
// served by the same server as the API, which lives under /api.
const sameOriginApi = import.meta.env?.PROD && typeof window !== 'undefined' ? `${window.location.origin}/api` : undefined;
export const api = createApi(import.meta.env?.VITE_API_URL || sameOriginApi || DEFAULT_API_URL);
