import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { DISPATCH_STATUSES } from '../logic/constants.js';
import { can } from '../logic/permissions.js';
import { availableStock, isOpenCamp, maxDispatchQuantity, remainingForNeed } from '../logic/rules.js';
import { validateDispatchInput } from '../logic/validators.js';
import { Badge, ConfirmDialog, EmptyState, Field, FormError, PageHeader, reportFormError } from '../components/ui.jsx';
import { fmt } from '../lib/format.js';

function DispatchForm({ initialCamp, initialNeed }) {
  const { data, run, lookups } = useApp();
  const [values, setValues] = useState({ camp_id: initialCamp, need_id: initialNeed, quantity: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const openCamps = data.camps.filter(isOpenCamp);
  const campNeeds = data.needs.filter((n) => String(n.camp_id) === String(values.camp_id));
  const need = lookups.needs.get(Number(values.need_id));
  const item = need ? lookups.items.get(need.inventory_item_id) : null;
  const valid = need && item && String(need.camp_id) === String(values.camp_id);
  const available = valid ? Math.max(0, availableStock(item, data.needs, data.dispatches)) : null;
  const remaining = valid ? Math.max(0, remainingForNeed(need, data.dispatches)) : null;
  const max = valid ? maxDispatchQuantity(need, item, data.needs, data.dispatches) : null;

  const setCamp = (e) => {
    setValues({ camp_id: e.target.value, need_id: '', quantity: '' });
    setErrors({});
    setFormError('');
  };
  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setFormError('');
  };

  async function submit(e) {
    e.preventDefault();
    const check = validateDispatchInput(values);
    if (!check.ok) {
      setErrors(check.errors);
      setFormError('');
      return;
    }
    setBusy(true);
    const outcome = await run(
      (a) => a.createDispatch(values),
      (d) => `Dispatch ${d.id} created. ${fmt(d.quantity)} ${item?.unit ?? ''} of ${item?.name ?? 'stock'} reserved.`.replace('  ', ' '),
      { inline: true },
    );
    setBusy(false);
    if (outcome.ok) {
      setValues((v) => ({ ...v, quantity: '' }));
      setErrors({});
      setFormError('');
    } else reportFormError(outcome.error, setErrors, setFormError);
  }

  return (
    <form className="panel" onSubmit={submit} noValidate aria-label="Create dispatch">
      <FormError>{formError}</FormError>
      <div className="form-grid">
        <Field label="Camp" error={errors.camp_id}>
          {(p) => (
            <select {...p} value={values.camp_id} onChange={setCamp}>
              <option value="">Choose a camp</option>
              {openCamps.map((c) => <option key={c.id} value={c.id}>{c.name}, {c.district}</option>)}
            </select>
          )}
        </Field>
        <Field label="Need" error={errors.need_id}>
          {(p) => (
            <select {...p} value={values.need_id} onChange={set('need_id')} disabled={!values.camp_id}>
              <option value="">{values.camp_id ? 'Choose a need' : 'Choose a camp first'}</option>
              {campNeeds.map((n) => {
                const i = lookups.items.get(n.inventory_item_id);
                const left = Math.max(0, remainingForNeed(n, data.dispatches));
                return (
                  <option key={n.id} value={n.id} disabled={left === 0}>
                    {i?.name ?? 'Unknown item'} ({n.priority}), {left === 0 ? 'fully covered' : `${fmt(left)} ${i?.unit ?? ''} unreserved`}
                  </option>
                );
              })}
            </select>
          )}
        </Field>
      </div>

      {valid && (
        <div className="limits" aria-live="polite">
          <div><p className="limit-value">{fmt(available)}</p><p className="limit-label">{item.unit} available in the warehouse</p></div>
          <div><p className="limit-value">{fmt(remaining)}</p><p className="limit-label">{item.unit} the camp still needs, unreserved</p></div>
          <div><p className="limit-value">{fmt(max)}</p><p className="limit-label">most you can send now</p></div>
        </div>
      )}

      <div className="form-grid">
        <Field label={`Quantity${item ? ` (${item.unit})` : ''}`} error={errors.quantity}>
          {(p) => <input {...p} type="number" min="1" max={max ?? undefined} inputMode="numeric" value={values.quantity} onChange={set('quantity')} />}
        </Field>
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating' : 'Create dispatch'}</button>
    </form>
  );
}

export default function Dispatches() {
  const { data, role, run, lookups } = useApp();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState('All');
  const [confirm, setConfirm] = useState(null); // { kind, dispatch }
  const [busy, setBusy] = useState(false);

  const canCreate = can(role, 'dispatch.create');
  const canTransit = can(role, 'dispatch.transit');
  const canDeliver = can(role, 'dispatch.deliver');
  const canCancel = can(role, 'dispatch.cancel');

  const counts = useMemo(() => {
    const c = { All: data.dispatches.length };
    for (const s of DISPATCH_STATUSES) c[s] = data.dispatches.filter((d) => d.status === s).length;
    return c;
  }, [data.dispatches]);

  const rows = useMemo(
    () => data.dispatches.filter((d) => filter === 'All' || d.status === filter).sort((a, b) => b.id - a.id),
    [data.dispatches, filter],
  );

  async function confirmAction() {
    const { kind, dispatch } = confirm;
    setBusy(true);
    if (kind === 'deliver') await run((a) => a.markDelivered(dispatch.id), `Dispatch ${dispatch.id} delivered. Stock and fulfilment updated.`);
    if (kind === 'cancel') await run((a) => a.cancelDispatch(dispatch.id), `Dispatch ${dispatch.id} cancelled. The stock is available again.`);
    setBusy(false);
    setConfirm(null);
  }

  const detail = (dispatch) => {
    const need = lookups.needs.get(dispatch.need_id);
    const item = need ? lookups.items.get(need.inventory_item_id) : null;
    return `${fmt(dispatch.quantity)} ${item?.unit ?? ''} of ${item?.name ?? 'stock'} to ${lookups.camps.get(dispatch.camp_id)?.name ?? 'the camp'}`;
  };

  return (
    <>
      <PageHeader eyebrow="Reservation hub" title="Dispatches" intro="Send stock to a camp's need. Stock is reserved the moment a dispatch is created, so two teams cannot promise the same supplies." />

      <section className="section" style={{ marginTop: 0 }} aria-labelledby="new-dispatch-title">
        <div className="section-head"><h2 id="new-dispatch-title">New dispatch</h2></div>
        {canCreate ? (
          <DispatchForm key={params.toString()} initialCamp={params.get('camp') ?? ''} initialNeed={params.get('need') ?? ''} />
        ) : (
          <p className="section-note">Only Relief Coordinators create dispatches. You can still mark In Transit dispatches as Delivered below.</p>
        )}
      </section>

      <section className="section" aria-labelledby="all-dispatch-title">
        <div className="section-head"><h2 id="all-dispatch-title">All dispatches</h2></div>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Filter by status">
            {['All', ...DISPATCH_STATUSES].map((s) => (
              <button key={s} type="button" className="seg-btn" aria-pressed={filter === s} onClick={() => setFilter(s)}>
                {s}<span className="seg-count">{counts[s]}</span>
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={filter === 'All' ? 'No dispatches yet' : `No ${filter} dispatches`}>
            {filter === 'All' ? 'Create the first dispatch above.' : 'Choose another status to see more.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">No.</th>
                  <th>Camp</th>
                  <th>Item</th>
                  <th className="num">Quantity</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const need = lookups.needs.get(d.need_id);
                  const item = need ? lookups.items.get(need.inventory_item_id) : null;
                  const camp = lookups.camps.get(d.camp_id);
                  return (
                    <tr key={d.id} className={d.status === 'Cancelled' ? 'row-muted' : ''}>
                      <td className="num">{d.id}</td>
                      <td>{camp ? <Link to={`/camps/${camp.id}`}>{camp.name}</Link> : 'Unknown camp'}<span className="cell-sub">{camp?.district}</span></td>
                      <td>{item?.name ?? 'Unknown item'}</td>
                      <td className="num">{fmt(d.quantity)} {item?.unit}</td>
                      <td><Badge label={d.status} /></td>
                      <td>
                        <div className="row-actions">
                          {d.status === 'Pending' && canTransit && (
                            <button type="button" className="btn btn-small" onClick={() => run((a) => a.markInTransit(d.id), `Dispatch ${d.id} is now In Transit.`)}>
                              Mark In Transit
                            </button>
                          )}
                          {d.status === 'In Transit' && canDeliver && (
                            <button type="button" className="btn btn-small" onClick={() => setConfirm({ kind: 'deliver', dispatch: d })}>Mark Delivered</button>
                          )}
                          {(d.status === 'Pending' || d.status === 'In Transit') && canCancel && (
                            <button type="button" className="btn btn-small" onClick={() => setConfirm({ kind: 'cancel', dispatch: d })}>Cancel</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'deliver' ? `Mark dispatch ${confirm.dispatch.id} delivered?` : `Cancel dispatch ${confirm.dispatch.id}?`}
          message={
            confirm.kind === 'deliver'
              ? `${detail(confirm.dispatch)}. The warehouse stock goes down and the camp's fulfilment goes up. This cannot be undone.`
              : `${detail(confirm.dispatch)}. The reserved stock becomes available again.`
          }
          confirmLabel={confirm.kind === 'deliver' ? 'Mark Delivered' : 'Cancel dispatch'}
          danger={confirm.kind === 'cancel'}
          busy={busy}
          onConfirm={confirmAction}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
