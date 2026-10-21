import { useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { SKILLS } from '../logic/constants.js';
import { can } from '../logic/permissions.js';
import { isOpenCamp } from '../logic/rules.js';
import { validateVolunteer } from '../logic/validators.js';
import { ConfirmDialog, EmptyState, Field, FormError, Modal, PageHeader, reportFormError } from '../components/ui.jsx';
import { plural } from '../lib/format.js';

function VolunteerForm({ volunteer, onClose }) {
  const { run } = useApp();
  const formId = useId();
  const [values, setValues] = useState({ name: volunteer?.name ?? '', skill: volunteer?.skill ?? '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const check = validateVolunteer(values);
    if (!check.ok) {
      setErrors(check.errors);
      setFormError('');
      return;
    }
    setBusy(true);
    const outcome = await run(
      (a) => (volunteer ? a.updateVolunteer(volunteer.id, values) : a.createVolunteer(values)),
      `${check.value.name} ${volunteer ? 'saved' : 'registered'}.`,
      { inline: true },
    );
    setBusy(false);
    if (outcome.ok) onClose();
    else reportFormError(outcome.error, setErrors, setFormError);
  }

  return (
    <Modal
      title={volunteer ? 'Edit volunteer' : 'Register volunteer'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Saving' : 'Save volunteer'}</button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <FormError>{formError}</FormError>
        <Field label="Full name" error={errors.name}>
          {(p) => <input {...p} value={values.name} onChange={set('name')} autoComplete="off" />}
        </Field>
        <Field label="Main skill" error={errors.skill}>
          {(p) => (
            <select {...p} value={values.skill} onChange={set('skill')}>
              <option value="">Choose a skill</option>
              {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </Field>
      </form>
    </Modal>
  );
}

export default function Volunteers() {
  const { data, role, run, lookups } = useApp();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [skill, setSkill] = useState('All');
  const [assignment, setAssignment] = useState('All');
  const [form, setForm] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [moving, setMoving] = useState(null); // { volunteer, camp }
  const [busy, setBusy] = useState(false);
  const canWrite = can(role, 'volunteer.write');
  const canAssign = can(role, 'volunteer.assign');

  const openCamps = useMemo(() => data.camps.filter(isOpenCamp), [data.camps]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.volunteers
      .filter((v) => skill === 'All' || v.skill === skill)
      .filter((v) => assignment === 'All' || (assignment === 'Assigned' ? v.camp_id != null : v.camp_id == null))
      .filter((v) => !q || v.name.toLowerCase().includes(q));
  }, [data.volunteers, query, skill, assignment]);

  const deployed = data.volunteers.filter((v) => v.camp_id != null).length;

  function onAssignChange(volunteer, value) {
    if (value === '') {
      run((a) => a.unassignVolunteer(volunteer.id), `${volunteer.name} unassigned.`);
      return;
    }
    const camp = lookups.camps.get(Number(value));
    if (volunteer.camp_id != null && volunteer.camp_id !== camp.id) {
      setMoving({ volunteer, camp });
      return;
    }
    run((a) => a.assignVolunteer(volunteer.id, camp.id), `${volunteer.name} assigned to ${camp.name}.`);
  }

  async function confirmMove() {
    const { volunteer, camp } = moving;
    setBusy(true);
    await run((a) => a.assignVolunteer(volunteer.id, camp.id), `${volunteer.name} moved to ${camp.name}.`);
    setBusy(false);
    setMoving(null);
  }

  async function confirmRemove() {
    setBusy(true);
    await run((a) => a.deleteVolunteer(removing.id), `${removing.name} removed.`);
    setBusy(false);
    setRemoving(null);
  }

  return (
    <>
      <PageHeader eyebrow="Deployment roster"
        title="Volunteers"
        intro={`${plural(deployed, 'volunteer')} deployed of ${data.volunteers.length} registered. Each volunteer serves one camp at a time.`}
        actions={canWrite && <button type="button" className="btn btn-primary" onClick={() => setForm({ volunteer: null })}>Register volunteer</button>}
      />

      <ul className="guardrails" aria-label="Assignment rules">
        <li><span className="guard-dot" aria-hidden="true" /> One camp per volunteer. Picking another camp moves them.</li>
        <li><span className="guard-dot" aria-hidden="true" /> Closed camps are locked and cannot be chosen.</li>
      </ul>

      <div className="toolbar">
        <input type="search" aria-label="Search volunteers by name" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Filter by skill" value={skill} onChange={(e) => setSkill(e.target.value)}>
          <option value="All">All skills</option>
          {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Filter by assignment" value={assignment} onChange={(e) => setAssignment(e.target.value)}>
          <option value="All">Assigned and unassigned</option>
          <option value="Assigned">Assigned only</option>
          <option value="Unassigned">Unassigned only</option>
        </select>
        <span className="count-note" aria-live="polite">{plural(rows.length, 'volunteer')} shown</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No volunteers match">Clear the search or filters to see everyone.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Skill</th>
                <th>Camp</th>
                {canWrite && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const camp = lookups.camps.get(v.camp_id);
                const options = camp && !isOpenCamp(camp) ? [camp, ...openCamps] : openCamps;
                return (
                  <tr key={v.id}>
                    <td className="strong">{v.name}</td>
                    <td>{v.skill}</td>
                    <td>
                      {canAssign ? (
                        <select aria-label={`Camp for ${v.name}`} value={v.camp_id ?? ''} onChange={(e) => onAssignChange(v, e.target.value)}>
                          <option value="">Unassigned</option>
                          {options.map((c) => (
                            <option key={c.id} value={c.id} disabled={!isOpenCamp(c)}>{c.name}</option>
                          ))}
                        </select>
                      ) : camp ? (
                        <Link to={`/camps/${camp.id}`}>{camp.name}</Link>
                      ) : (
                        'Unassigned'
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn btn-small" onClick={() => setForm({ volunteer: v })}>Edit</button>
                          <button type="button" className="btn btn-small" onClick={() => setRemoving(v)}>Remove</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="table-note">Closed camps cannot be chosen. Picking a different camp for an assigned volunteer moves them.</p>

      {form && <VolunteerForm volunteer={form.volunteer} onClose={() => setForm(null)} />}
      {moving && (
        <ConfirmDialog
          title={`Move ${moving.volunteer.name}?`}
          message={`${moving.volunteer.name} is at ${lookups.camps.get(moving.volunteer.camp_id)?.name ?? 'another camp'}. They will move to ${moving.camp.name}.`}
          confirmLabel="Move volunteer"
          busy={busy}
          onConfirm={confirmMove}
          onCancel={() => setMoving(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          message="They are deleted from the volunteer list and leave their camp."
          confirmLabel="Remove volunteer"
          danger
          busy={busy}
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  );
}
