import { useApp } from '../context/AppContext.jsx';

const CONNECTION = {
  online: { text: 'Connected', tone: 'online' },
  offline: { text: 'Offline', tone: 'offline' },
  checking: { text: 'Connecting', tone: 'checking' },
};

export default function ConnectionBadge() {
  const { connection } = useApp();
  const status = CONNECTION[connection] || CONNECTION.checking;
  return (
    <span className={`conn conn-${status.tone}`} role="status">
      <span className="conn-dot" aria-hidden="true" />
      {status.text}
    </span>
  );
}
