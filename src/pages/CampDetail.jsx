import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { PRIORITIES } from '../logic/constants.js';
import { can } from '../logic/permissions.js';
import { isOverCapacity, needProgress, remainingForNeed, reservedForNeed, resolveCampStatus, underservedCampIds } from '../logic/rules.js';
import { validateNeed } from '../logic/validators.js';
import { Badge, ConfirmDialog, EmptyState, Field, FormError, Meter, Modal, PageHeader, reportFormError } from '../components/ui.jsx';
import { fmt } from '../lib/format.js';

const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };

function NeedForm({ campId, need, items, onClose }) {
  const { run } = useApp();
  const formId = useId();
  const [values, setValues] = useState({
    inventory_item_id: need?.inventory_item_id ?? '',
    required_quantity: need?.required_quantity ?? '',
    priority: need?.priority ?? 'High',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const check = validateNeed(values);
    if (!check.ok) {
      setErrors(check.errors);
      setFormError('');
      return;
    }
    setBusy(true);
    const outcome = await run(
      (a) => (need ? a.updateNeed(need.id, values) : a.createNeed({ ...values, camp_id: campId })),
      need ? 'Need updated.' : 'Need added.',
      { inline: true },
    );
    setBusy(false);
    if (outcome.ok) onClose();
    else reportFormError(outcome.error, setErrors, setFormError);
  }

  return (
    <Modal
      title={need ? 'Edit need' : 'Add need'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Saving' : 'Save need'}</button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <FormError>{formError}</FormError>
        <Field label="Inventory item" error={errors.inventory_item_id} hint={need ? 'The item cannot change. Remove the need to pick another.' : undefined}>
          {(p) => (
            <select {...p} value={values.inventory_item_id} onChange={set('inventory_item_id')} disabled={Boolean(need)}>
              <option value="">Choose an item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
              ))}
            </select>
          )}
        </Field>
        <div className="form-grid">
          <Field label="Quantity required" error={errors.required_quantity}>
            {(p) => <input {...p} type="number" min="1" inputMode="numeric" value={values.required_quantity} onChange={set('required_quantity')} />}
          </Field>
          <Field label="Priority" error={errors.priority}>
            {(p) => (
              <select {...p} value={values.priority} onChange={set('priority')}>
                {PRIORITIES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
              </select>
            )}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export default function CampDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const campId = Number(id);
  const focusNeed = Number(params.get('need')) || null;
  const { data, role, run, lookups, loaded } = useApp();
  const [form, setForm] = useState(null); // { need } where need is null when adding
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const camp = lookups.camps.get(campId);
  const isAdmin = can(role, 'need.write');
  const canDispatch = can(role, 'dispatch.create');

  const needs = useMemo(
    () =>
      data.needs
        .filter((n) => n.camp_id === campId)
        .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || needProgress(a) - needProgress(b) || a.id - b.id),
    [data.needs, campId],
  );
  const underserved = useMemo(() => underservedCampIds(data.camps, data.needs), [data.camps, data.needs]);

  useEffect(() => {
    if (!focusNeed || !loaded) return;
    document.getElementById(`need-${focusNeed}`)?.scrollIntoView?.({ block: 'center' });
  }, [focusNeed, loaded, needs.length]);

  if (!camp) {
    return (
      <EmptyState title="Camp not found">
        It may have been deleted. <Link to="/camps">Back to camps</Link>
      </EmptyState>
    );
  }

  const status = resolveCampStatus(camp);
  const volunteers = data.volunteers.filter((v) => v.camp_id === campId);
  const dispatches = data.dispatches.filter((d) => d.camp_id === campId).sort((a, b) => b.id - a.id);
  const usedItemIds = new Set(needs.map((n) => n.inventory_item_id));
  const freeItems = data.inventory.filter((i) => !usedItemIds.has(i.id));
  const fill = Math.min(100, Math.round((camp.current_families / camp.capacity) * 100));

  async function removeNeed() {
    setBusy(true);
    await run((a) => a.deleteNeed(removing.id), 'Need removed.');
    setBusy(false);
    setRemoving(null);
  }

  return (
    <>
      <Link to="/camps" className="back-link">All camps</Link>
      <PageHeader eyebrow="Camp profile" title={camp.name} />
      <div className="detail-meta">
        <Badge label={status} />
        {underserved.has(camp.id) && <Badge label="Underserved" />}
        <span>{camp.district}</span>
        <span className="occupancy">
          <span className="occupancy-track" aria-hidden="true">
            <span className={`occupancy-fill ${status === 'Full' ? 'is-full' : ''}`} style={{ display: 'block', width: `${fill}%` }} />
          </span>
          {fmt(camp.current_families)} of {fmt(camp.capacity)} families
          {isOverCapacity(camp) && ` (over capacity by ${fmt(camp.current_families - camp.capacity)})`}
        </span>
      </div>

      <section className="section" aria-labelledby="needs-title">
        <div className="section-head">
          <h2 id="needs-title">Needs</h2>
          {isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setForm({ need: null })} disabled={freeItems.length === 0}>
              Add need
            </button>
          )}
        </div>
        {needs.length === 0 ? (
          <EmptyState title="No needs recorded">Add the supplies this camp is waiting for so they show up on the dashboard.</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Priority</th>
                    <th className="num">Required</th>
                    <th className="num">Delivered</th>
                    <th className="num">On the way</th>
                    <th>Fulfilment</th>
                    {(isAdmin || canDispatch) && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {needs.map((need) => {
                    const item = lookups.items.get(need.inventory_item_id);
                    const reserved = reservedForNeed(need.id, data.dispatches);
                    const remaining = remainingForNeed(need, data.dispatches);
                    return (
                      <tr key={need.id} id={`need-${need.id}`} className={need.id === focusNeed ? 'row-focus' : ''}>
                        <td>
                          <strong>{item?.name ?? 'Unknown item'}</strong>
                          <span className="cell-sub">{item?.category} · {item?.unit}</span>
                        </td>
                        <td><Badge label={need.priority} /></td>
                        <td className="num">{fmt(need.required_quantity)}</td>
                        <td className="num">{fmt(need.fulfilled_quantity)}</td>
                        <td className="num">{fmt(reserved)}</td>
                        <td><Meter value={needProgress(need)} priority={need.priority} /></td>
                        {(isAdmin || canDispatch) && (
                          <td>
                            <div className="row-actions">
                              {canDispatch && status !== 'Closed' && remaining > 0 && (
                                <Link className="btn btn-small" to={`/dispatches?camp=${campId}&need=${need.id}`}>Dispatch</Link>
                              )}
                              {isAdmin && (
                                <>
                                  <button type="button" className="btn btn-small" onClick={() => setForm({ need })}>Edit</button>
                                  <button type="button" className="btn btn-small" onClick={() => setRemoving(need)}>Remove</button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="legend"><span className="legend-line" aria-hidden="true" /> The line marks 40%. A High priority need below it is a critical gap.</p>
          </>
        )}
      </section>

      <section className="section" aria-labelledby="vol-title">
        <div className="section-head"><h2 id="vol-title">Volunteers here</h2></div>
        {volunteers.length === 0 ? (
          <EmptyState title="No volunteers assigned">Assign people from the <Link to="/volunteers">Volunteers</Link> page.</EmptyState>
        ) : (
          <ul className="people-list">
            {volunteers.map((v) => (
              <li key={v.id}><span>{v.name}</span><span>{v.skill}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="disp-title">
        <div className="section-head"><h2 id="disp-title">Dispatches to this camp</h2></div>
        {dispatches.length === 0 ? (
          <EmptyState title="Nothing dispatched yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th className="num">No.</th><th>Item</th><th className="num">Quantity</th><th>Status</th></tr>
              </thead>
              <tbody>
                {dispatches.map((d) => {
                  const item = lookups.items.get(lookups.needs.get(d.need_id)?.inventory_item_id);
                  return (
                    <tr key={d.id}>
                      <td className="num">{d.id}</td>
                      <td>{item?.name ?? 'Unknown item'}</td>
                      <td className="num">{fmt(d.quantity)} {item?.unit}</td>
                      <td><Badge label={d.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && <NeedForm campId={campId} need={form.need} items={form.need ? [lookups.items.get(form.need.inventory_item_id)].filter(Boolean) : freeItems} onClose={() => setForm(null)} />}
      {removing && (
        <ConfirmDialog
          title="Remove this need?"
          message={`${lookups.items.get(removing.inventory_item_id)?.name ?? 'This need'} will no longer be tracked for ${camp.name}. Its Delivered and Cancelled dispatch records are removed with it.`}
          confirmLabel="Remove need"
          danger
          busy={busy}
          onConfirm={removeNeed}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  );
}
