import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { CATEGORIES } from '../logic/constants.js';
import { can } from '../logic/permissions.js';
import { donationTotals } from '../logic/rules.js';
import { validateDonation } from '../logic/validators.js';
import { Badge, EmptyState, Field, FormError, PageHeader, reportFormError } from '../components/ui.jsx';
import { fmt, fmtDate, fmtPKR, todayIso } from '../lib/format.js';

const blank = () => ({ type: 'Cash', donor_name: '', category: '', item_id: '', amount_or_quantity: '', date: todayIso() });

function DonationForm() {
  const { data, run, lookups } = useApp();
  const [values, setValues] = useState(blank);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const item = values.type === 'In-Kind' ? lookups.items.get(Number(values.item_id)) : null;

  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const setType = (type) => {
    setValues((v) => ({ ...v, type, category: '', item_id: '', amount_or_quantity: '' }));
    setErrors({});
    setFormError('');
  };

  async function submit(e) {
    e.preventDefault();
    const check = validateDonation(values);
    if (!check.ok) {
      setErrors(check.errors);
      setFormError('');
      return;
    }
    setBusy(true);
    const outcome = await run(
      (a) => a.createDonation(values),
      values.type === 'Cash'
        ? `Cash donation of ${fmtPKR(check.value.amount_or_quantity)} recorded.`
        : `Donation recorded. ${item?.name ?? 'Item'} stock increased by ${fmt(check.value.amount_or_quantity)}.`,
      { inline: true },
    );
    setBusy(false);
    if (outcome.ok) {
      setValues(blank());
      setErrors({});
      setFormError('');
    } else reportFormError(outcome.error, setErrors, setFormError);
  }

  return (
    <form className="panel" onSubmit={submit} noValidate aria-label="Record donation">
      <FormError>{formError}</FormError>
      <div className="type-switch" role="radiogroup" aria-label="Donation type">
        {['Cash', 'In-Kind'].map((t) => (
          <span key={t}>
            <input type="radio" name="donation-type" id={`type-${t}`} value={t} checked={values.type === t} onChange={() => setType(t)} />
            <label htmlFor={`type-${t}`}>{t}</label>
          </span>
        ))}
      </div>
      <div className="form-grid">
        {values.type === 'Cash' ? (
          <>
            <Field label="Amount (PKR)" error={errors.amount_or_quantity}>
              {(p) => <input {...p} type="number" min="1" inputMode="numeric" value={values.amount_or_quantity} onChange={set('amount_or_quantity')} />}
            </Field>
            <Field label="Category it is for" error={errors.category}>
              {(p) => (
                <select {...p} value={values.category} onChange={set('category')}>
                  <option value="">Choose a category</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </Field>
          </>
        ) : (
          <>
            <Field label="Item donated" error={errors.item_id}>
              {(p) => (
                <select {...p} value={values.item_id} onChange={set('item_id')}>
                  <option value="">Choose an item</option>
                  {data.inventory.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                </select>
              )}
            </Field>
            <Field label={`Quantity${item ? ` (${item.unit})` : ''}`} error={errors.amount_or_quantity} hint={item ? `Adds to ${item.name} stock. Category: ${item.category}.` : undefined}>
              {(p) => <input {...p} type="number" min="1" inputMode="numeric" value={values.amount_or_quantity} onChange={set('amount_or_quantity')} />}
            </Field>
          </>
        )}
        <Field label="Donor (optional)" error={errors.donor_name}>
          {(p) => <input {...p} value={values.donor_name} onChange={set('donor_name')} autoComplete="off" />}
        </Field>
        <Field label="Date received">
          {(p) => <input {...p} type="date" value={values.date} onChange={set('date')} />}
        </Field>
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Recording' : 'Record donation'}</button>
    </form>
  );
}

export default function Donations() {
  const { data, role, lookups } = useApp();
  const canWrite = can(role, 'donation.write');
  const totals = useMemo(() => donationTotals(data.donations), [data.donations]);
  const rows = useMemo(() => [...data.donations].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id), [data.donations]);

  return (
    <>
      <PageHeader eyebrow="Cash and in-kind" title="Donations" intro="Cash is tracked as money received. In-Kind gifts add straight to warehouse stock." />

      <div className="donation-totals">
        <div>
          <p className="big-figure">{fmtPKR(totals.totalCash)}</p>
          <p className="big-label">cash received in total</p>
        </div>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Donations by category</caption>
            <thead>
              <tr><th>Category</th><th className="num">Cash received</th><th className="num">In-Kind gifts</th></tr>
            </thead>
            <tbody>
              {totals.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td>
                  <td className="num">{fmtPKR(c.cash)}</td>
                  <td className="num">{fmt(c.inKindCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="section" aria-labelledby="record-title">
        <div className="section-head"><h2 id="record-title">Record a donation</h2></div>
        {canWrite ? <DonationForm /> : <p className="section-note">Only Relief Coordinators record donations.</p>}
      </section>

      <section className="section" aria-labelledby="donation-list-title">
        <div className="section-head"><h2 id="donation-list-title">All donations</h2></div>
        {rows.length === 0 ? (
          <EmptyState title="No donations recorded yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Donor</th><th>Type</th><th>Gift</th><th>Category</th></tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const item = d.type === 'In-Kind' ? lookups.items.get(d.item_id) : null;
                  return (
                    <tr key={d.id}>
                      <td>{fmtDate(d.date)}</td>
                      <td>{d.donor_name || 'Anonymous'}</td>
                      <td><Badge label={d.type} tone={d.type === 'Cash' ? 'info' : 'good'} /></td>
                      <td>{d.type === 'Cash' ? fmtPKR(d.amount_or_quantity) : `${fmt(d.amount_or_quantity)} ${item?.unit ?? ''} of ${item?.name ?? 'an item no longer listed'}`}</td>
                      <td>{d.category}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
