import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { initials, roleTitle } from '../logic/permissions.js';
import ConnectionBadge from './ConnectionBadge.jsx';
import SignIn from './SignIn.jsx';
import '../signin.css';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/camps', label: 'Camps' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/dispatches', label: 'Dispatches' },
  { to: '/donations', label: 'Donations' },
  { to: '/volunteers', label: 'Volunteers' },
];

// Searches camps, warehouse items and volunteers and links to each.
function GlobalSearch() {
  const { data } = useApp();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const camps = data.camps
      .filter((c) => c.name.toLowerCase().includes(q) || c.district.toLowerCase().includes(q))
      .map((c) => ({ key: `camp-${c.id}`, kind: 'Camp', label: c.name, sub: c.district, to: `/camps/${c.id}` }));
    const items = data.inventory
      .filter((i) => i.name.toLowerCase().includes(q))
      .map((i) => ({ key: `item-${i.id}`, kind: 'Item', label: i.name, sub: i.category, to: `/inventory?q=${encodeURIComponent(i.name)}` }));
    const people = data.volunteers
      .filter((v) => v.name.toLowerCase().includes(q))
      .map((v) => ({ key: `vol-${v.id}`, kind: 'Volunteer', label: v.name, sub: v.skill, to: `/volunteers?q=${encodeURIComponent(v.name)}` }));
    return [...camps, ...items, ...people].slice(0, 8);
  }, [data, query]);

  useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const showList = open && query.trim().length >= 2;

  return (
    <div className="gsearch" ref={box}>
      <input
        type="search"
        aria-label="Search camps, items and volunteers"
        placeholder="Search camps, items, volunteers"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        autoComplete="off"
      />
      {showList && (
        <ul className="gsearch-list" aria-label="Search results">
          {results.length === 0 ? (
            <li className="gsearch-empty">No match for "{query.trim()}"</li>
          ) : (
            results.map((r) => (
              <li key={r.key}>
                <Link to={r.to}>
                  <span className="gsearch-kind">{r.kind}</span>
                  <span className="gsearch-label">{r.label}</span>
                  <span className="gsearch-sub">{r.sub}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, signOut, refresh, loaded, loadError, toasts, dismissToast } = useApp();

  if (!user) return <SignIn />;

  return (
    <div className="shell">
      <header className="command-bar">
        <div className="command-row">
          <Link to="/" className="app-title" aria-label="Kinara Relief, dashboard">
            <span className="app-mark" aria-hidden="true" />
            <span>Kinara <strong>Relief</strong></span>
          </Link>
          <GlobalSearch />
          <div className="command-tools">
            <ConnectionBadge />
            <span className="whoami">
              <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
              <span className="who-name">{user.name}</span>
            </span>
            <span className="role-chip" title="Your role">{roleTitle(user.role)}</span>
            <button type="button" className="btn btn-ghost btn-small" onClick={refresh}>Refresh data</button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => signOut()}>Sign out</button>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="main" id="main">
        {loadError && (
          <div className="banner" role="alert">
            <p>{loaded ? 'Showing the last data loaded. ' : ''}{loadError}</p>
            <button type="button" className="btn" onClick={refresh}>Try again</button>
          </div>
        )}
        {!loaded && !loadError ? <p className="loading" role="status">Loading data</p> : null}
        {loaded || loadError ? (loaded ? <Outlet /> : (
          <div className="empty">
            <p className="empty-title">The data could not be loaded</p>
            <p className="empty-text">Check your connection, then choose Try again.</p>
          </div>
        )) : null}
      </main>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
            <span>{t.message}</span>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>Close</button>
          </div>
        ))}
      </div>
    </div>
  );
}
