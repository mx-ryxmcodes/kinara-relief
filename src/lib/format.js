const numberFormat = new Intl.NumberFormat('en-PK');

export const fmt = (n) => numberFormat.format(Number(n) || 0);
export const fmtPKR = (n) => `PKR ${fmt(n)}`;
export const fmtPct = (fraction) => `${Math.round(fraction * 100)}%`;

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const plural = (n, word) => `${fmt(n)} ${word}${Number(n) === 1 ? '' : 's'}`;
