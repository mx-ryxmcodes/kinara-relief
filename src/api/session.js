// The signed-in session ({ token, user }) kept in this browser.
const KEY = 'flood-relief-session';

export function readSession() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const session = raw ? JSON.parse(raw) : null;
    return session?.token && session?.user ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* the session just will not survive a reload */
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
