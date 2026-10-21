import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api as defaultApi } from '../api/client.js';
import { createActions, errorMessage } from '../logic/actions.js';
import { createServerActions } from '../logic/serverActions.js';
import { COLLECTIONS } from '../logic/constants.js';
import { UNAUTHORIZED_EVENT } from '../api/client.js';
import { clearSession, readSession, saveSession } from '../api/session.js';

const AppContext = createContext(null);

const emptyData = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
export function AppProvider({ api = defaultApi, children }) {
  const actions = useMemo(() => {
    const local = createActions(api);
    return typeof api.callAction === 'function' ? createServerActions(api, local) : local;
  }, [api]);
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [session, setSession] = useState(readSession);
  const [notice, setNotice] = useState('');
  const [toasts, setToasts] = useState([]);
  const [connection, setConnection] = useState('checking'); // checking | online | offline
  const toastId = useRef(0);
  const timers = useRef(new Set());

  const refresh = useCallback(async () => {
    try {
      setData(await api.loadAll());
      setLoaded(true);
      setLoadError('');
      setConnection('online');
      return true;
    } catch (err) {
      setLoadError(errorMessage(err));
      setConnection('offline');
      return false;
    }
  }, [api]);

  useEffect(() => {
    if (session) refresh();
  }, [refresh, session]);

  // Is the API reachable? Works before sign-in too.
  useEffect(() => {
    let cancelled = false;
    api.ping().then((ok) => {
      if (!cancelled) setConnection((prev) => (prev === 'checking' ? (ok ? 'online' : 'offline') : prev));
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Light check of the API every 20 seconds so the header badge stays honest.
  // When the API comes back after an outage the data is reloaded.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        if (!(await api.ping())) throw new Error('offline');
        setConnection((prev) => {
          if (prev === 'offline' && readSession()) refresh();
          return 'online';
        });
      } catch {
        setConnection('offline');
      }
    }, 20000);
    return () => clearInterval(id);
  }, [api, refresh]);

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach(clearTimeout);
  }, []);

  const dismissToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const notify = useCallback(
    (message, type = 'success') => {
      const id = ++toastId.current;
      setToasts((list) => [...list, { id, message, type }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        dismissToast(id);
      }, type === 'error' ? 8000 : 4500);
      timers.current.add(timer);
    },
    [dismissToast],
  );

  const user = session?.user ?? null;
  const role = user ? user.role : null;

  // Checks the ID and password on the server. Throws with a message to show.
  const signIn = useCallback(
    async (username, password) => {
      const result = await api.login(username, password);
      const next = { token: result.token, user: result.user };
      saveSession(next);
      setNotice('');
      setSession(next);
    },
    [api],
  );

  const signOut = useCallback((message = '') => {
    clearSession();
    setSession(null);
    setData(emptyData);
    setLoaded(false);
    setLoadError('');
    setNotice(typeof message === 'string' ? message : '');
  }, []);

  // The server said the session is over (expired, or the account was removed).
  useEffect(() => {
    const onUnauthorized = () => signOut('Your session has ended. Sign in again.');
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [signOut]);

  // Runs an action, reloads the data, and reports the outcome. With
  // `inline: true` the caller shows errors itself (for example in a form).
  const run = useCallback(
    async (fn, success, { inline = false } = {}) => {
      try {
        const result = await fn(actions);
        await refresh();
        if (success) notify(typeof success === 'function' ? success(result) : success, 'success');
        return { ok: true, result };
      } catch (err) {
        if (!inline) notify(errorMessage(err), 'error');
        await refresh();
        return { ok: false, error: err };
      }
    },
    [actions, refresh, notify],
  );

  const lookups = useMemo(
    () => ({
      camps: new Map(data.camps.map((c) => [c.id, c])),
      items: new Map(data.inventory.map((i) => [i.id, i])),
      needs: new Map(data.needs.map((n) => [n.id, n])),
    }),
    [data],
  );

  const value = useMemo(
    () => ({ data, loaded, loadError, connection, user, role, notice, signIn, signOut, refresh, run, notify, toasts, dismissToast, lookups, apiUrl: api.baseUrl }),
    [data, loaded, loadError, connection, user, role, notice, signIn, signOut, refresh, run, notify, toasts, dismissToast, lookups, api],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
