import { useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { SINDH_DISTRICTS } from '../logic/constants.js';
import { can } from '../logic/permissions.js';
import { isOverCapacity, resolveCampStatus, underservedCampIds } from '../logic/rules.js';
import { validateCamp, toInt } from '../logic/validators.js';
import { Badge, ConfirmDialog, EmptyState, Field, FormError, Modal, PageHeader, reportFormError } from '../components/ui.jsx';
import { fmt, plural } from '../lib/format.js';

const STATUS_FILTERS = ['All', 'Active', 'Full', 'Closed'];

function CampForm({ camp, volunteerCount, onClose }) {
  const { run } = useApp();
  const formId = useId();
  const [values, setValues] = useState({
    name: camp?.name ?? '',
    district: camp?.district ?? '',
    capacity: camp?.capacity ?? '',
    current_families: camp?.current_families ?? '',
    status: camp?.status === 'Closed' ? 'Closed' : 'Active',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const closing = Boolean(camp) && values.status === 'Closed' && camp.status !== 'Closed' && volunteerCount > 0;

  async function submit(e) {
    e.preventDefault();
    const check = validateCamp(values);
    if (!check.ok) {
      setErrors(check.errors);
      setFormError('');
      return;
    }
    setBusy(true);
    const outcome = await run(
      (a) => (camp ? a.updateCamp(camp.id, values) : a.createCamp(values)),
      (r) => {
        if (!camp) return `${check.value.name} added.`;
        return r.unassigned ? `${check.value.name} saved. ${plural(r.unassigned, 'volunteer')} unassigned.` : `${check.value.name} saved.`;
      },
      { inline: true },
    );
    setBusy(false);
    if (outcome.ok) onClose();
    else reportFormError(outcome.error, setErrors, setFormError);
  }

  return (
    <Modal
      title={camp ? 'Edit camp' : 'Add camp'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving' : closing ? `Save and unassign ${plural(volunteerCount, 'volunteer')}` : 'Save camp'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <FormError>{formError}</FormError>
        <Field label="Camp name" error={errors.name}>
          {(p) => <input {...p} value={values.name} onChange={set('name')} autoComplete="off" />}
        </Field>
        <Field label="District" error={errors.district}>
          {(p) => <input {...p} list="district-options" value={values.district} onChange={set('district')} autoComplete="off" />}
        </Field>
        <div className="form-grid">
          <Field label="Capacity (families)" error={errors.capacity}>
            {(p) => <input {...p} type="number" min="1" inputMode="numeric" value={values.capacity} onChange={set('capacity')} />}
          </Field>
          <Field label="Families now" error={errors.current_families}>
            {(p) => <input {...p} type="number" min="0" inputMode="numeric" value={values.current_families} onChange={set('current_families')} />}
          </Field>
        </div>
        <Field label="Status" hint="An open camp becomes Full automatically when families reach capacity.">
          {(p) => (
            <select {...p} value={values.status} onChange={set('status')}>
              <option value="Active">Open (Active or Full)</option>
              <option value="Closed">Closed</option>
            </select>
          )}
        </Field>
        {closing && <p className="form-note">Closing this camp will unassign {plural(volunteerCount, 'volunteer')}.</p>}
      </form>
    </Modal>
  );
}

function FamiliesForm({ camp, onClose }) {
  const { run } = useApp();
  const formId = useId();
  const [value, setValue] = useState(camp.current_families);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const n = toInt(value);
    if (Number.isNaN(n) || n < 0) {
      setError('Families must be a whole number, 0 or more.');
      return;
    }
    setBusy(true);
    const outcome = await run((a) => a.updateCampFamilies(camp.id, n), `${camp.name} updated.`, { inline: true });
    setBusy(false);
    if (outcome.ok) onClose();
    else setError(outcome.error.message);
  }

  return (
    <Modal
      title={`Update families at ${camp.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Saving' : 'Save'}</button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Field label={`Families now (capacity ${fmt(camp.capacity)})`} error={error}>
          {(p) => <input {...p} type="number" min="0" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
}

export default function Camps() {
  const { data, role, run } = useApp();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [statusFilter, setStatusFilter] = useState('All');
  const [districtFilter, setDistrictFilter] = useState('All');
  const [form, setForm] = useState(null); // { camp } where camp is null when adding
  const [familiesCamp, setFamiliesCamp] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind, camp }
  const [busy, setBusy] = useState(false);
  const isAdmin = can(role, 'camp.write');
  const canFamilies = can(role, 'camp.families');

  const underserved = useMemo(() => underservedCampIds(data.camps, data.needs), [data.camps, data.needs]);
  const volunteerCount = (campId) => data.volunteers.filter((v) => v.camp_id === campId).length;

  const districts = useMemo(() => [...new Set(data.camps.map((c) => c.district))].sort(), [data.camps]);

  const camps = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.camps
      .map((c) => ({ ...c, status: resolveCampStatus(c) }))
      .filter((c) => statusFilter === 'All' || c.status === statusFilter)
      .filter((c) => districtFilter === 'All' || c.district === districtFilter)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.district.toLowerCase().includes(q));
  }, [data.camps, query, statusFilter, districtFilter]);

  async function confirmAction() {
    const { kind, camp } = confirm;
    setBusy(true);
    if (kind === 'delete') await run((a) => a.deleteCamp(camp.id), `${camp.name} deleted.`);
    if (kind === 'close') {
      await run((a) => a.setCampClosed(camp.id, true), (r) => (r.unassigned ? `${camp.name} closed. ${plural(r.unassigned, 'volunteer')} unassigned.` : `${camp.name} closed.`));
    }
    if (kind === 'reopen') await run((a) => a.setCampClosed(camp.id, false), `${camp.name} reopened.`);
    setBusy(false);
    setConfirm(null);
  }

  const confirmCopy = confirm && {
    delete: {
      title: `Delete ${confirm.camp.name}?`,
      message: 'This also removes its needs and past dispatches, and unassigns its volunteers. It cannot be undone.',
      label: 'Delete camp',
      danger: true,
    },
    close: {
      title: `Close ${confirm.camp.name}?`,
      message: volunteerCount(confirm.camp.id)
        ? `${plural(volunteerCount(confirm.camp.id), 'volunteer')} will be unassigned. Closed camps cannot receive dispatches or volunteers.`
        : 'Closed camps cannot receive dispatches or volunteers. You can reopen it later.',
      label: 'Close camp',
      danger: false,
    },
    reopen: {
      title: `Reopen ${confirm.camp.name}?`,
      message: 'The camp becomes Active, or Full if its families have reached capacity.',
      label: 'Reopen camp',
      danger: false,
    },
  }[confirm.kind];

  return (
    <>
      <PageHeader eyebrow="Camp registry"
        title="Camps"
        intro="Every relief camp, with how full it is and whether it is falling behind on supplies."
        actions={isAdmin && <button type="button" className="btn btn-primary" onClick={() => setForm({ camp: null })}>Add camp</button>}
      />

      <div className="toolbar">
        <input type="search" aria-label="Search camps by name or district" placeholder="Search by name or district" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>{s === 'All' ? 'All statuses' : s}</option>
          ))}
        </select>
        <select aria-label="Filter by district" value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)}>
          <option value="All">All districts</option>
          {districts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="count-note" aria-live="polite">{plural(camps.length, 'camp')} shown</span>
      </div>

      {camps.length === 0 ? (
        <EmptyState title="No camps match">Clear the search or choose a different status or district.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Camp</th>
                <th>District</th>
                <th className="num">Families</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {camps.map((camp) => (
                <tr key={camp.id} className={camp.status === 'Closed' ? 'row-muted' : ''}>
                  <td>
                    <span className="badge-row">
                      <Link to={`/camps/${camp.id}`}><strong>{camp.name}</strong></Link>
                      {underserved.has(camp.id) && <Badge label="Underserved" />}
                    </span>
                  </td>
                  <td>{camp.district}</td>
                  <td className="num">
                    {fmt(camp.current_families)} of {fmt(camp.capacity)}
                    {isOverCapacity(camp) && <span className="cell-sub">Over capacity by {fmt(camp.current_families - camp.capacity)}</span>}
                  </td>
                  <td><Badge label={camp.status} /></td>
                  <td>
                    <div className="row-actions">
                      {isAdmin && (
                        <>
                          <button type="button" className="btn btn-small" onClick={() => setForm({ camp })}>Edit</button>
                          {camp.status === 'Closed' ? (
                            <button type="button" className="btn btn-small" onClick={() => setConfirm({ kind: 'reopen', camp })}>Reopen</button>
                          ) : (
                            <button type="button" className="btn btn-small" onClick={() => setConfirm({ kind: 'close', camp })}>Close</button>
                          )}
                          <button type="button" className="btn btn-small" onClick={() => setConfirm({ kind: 'delete', camp })}>Delete</button>
                        </>
                      )}
                      {!isAdmin && canFamilies && (
                        <button type="button" className="btn btn-small" onClick={() => setFamiliesCamp(camp)}>Update families</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <datalist id="district-options">
        {SINDH_DISTRICTS.map((d) => <option key={d} value={d} />)}
      </datalist>

      {form && <CampForm camp={form.camp} volunteerCount={form.camp ? volunteerCount(form.camp.id) : 0} onClose={() => setForm(null)} />}
      {familiesCamp && <FamiliesForm camp={familiesCamp} onClose={() => setFamiliesCamp(null)} />}
      {confirm && (
        <ConfirmDialog
          title={confirmCopy.title}
          message={confirmCopy.message}
          confirmLabel={confirmCopy.label}
          danger={confirmCopy.danger}
          busy={busy}
          onConfirm={confirmAction}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
