// Small shared building blocks: badges, meter, modal, confirm dialog, form field.
import { useEffect, useId, useRef } from 'react';
import { CRITICAL_THRESHOLD } from '../logic/constants.js';

const TONES = {
  Active: 'good',
  Full: 'warn',
  Closed: 'muted',
  Pending: 'warn',
  'In Transit': 'info',
  Delivered: 'good',
  Cancelled: 'muted',
  High: 'bad',
  Medium: 'warn',
  Low: 'good',
  'Low Stock': 'bad',
  Underserved: 'bad',
};

export function Badge({ label, tone, children }) {
  return <span className={`badge badge-${tone || TONES[label] || 'muted'}`}>{children || label}</span>;
}

// Progress toward a need. The vertical line marks the 40% critical-gap
// threshold, so the rule is visible on every bar.
export function Meter({ value, priority, label = 'fulfilled' }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  let tone = 'river';
  if (value >= 1) tone = 'moss';
  else if (value < CRITICAL_THRESHOLD) tone = priority === 'High' ? 'gap' : 'amber';
  return (
    <div className="meter" role="img" aria-label={`${pct}% ${label}`}>
      <div className="meter-track">
        <div className={`meter-fill meter-${tone}`} style={{ width: `${pct}%` }} />
        <span className="meter-line" style={{ left: `${CRITICAL_THRESHOLD * 100}%` }} />
      </div>
      <span className="meter-value">{pct}%</span>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide = false }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const first = panel.current?.querySelector('input, select, textarea');
    (first || panel.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  const titleId = useId();
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
        <h2 id={titleId} className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel, danger = false, busy = false, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Keep as is</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-text">{message}</p>
    </Modal>
  );
}

// Wraps one input with its label and error. `children` is a function that
// receives the props to spread on the input.
export function Field({ label, error, hint, children }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const input = children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy });
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {input}
      {error ? <p className="field-error" id={`${id}-error`}>{error}</p> : hint ? <p className="field-hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
    </div>
  );
}

export function PageHeader({ title, intro, actions, eyebrow }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {intro && <p className="page-intro">{intro}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function FormError({ children }) {
  return children ? <p className="form-error" role="alert">{children}</p> : null;
}

// Shows a rule error on the field it belongs to; only errors that belong to
// no field go in the banner at the top of the form.
export function reportFormError(error, setErrors, setFormError) {
  const fields = error?.fields && Object.keys(error.fields).length ? error.fields : {};
  setErrors(fields);
  setFormError(Object.keys(fields).length ? '' : error.message);
}
