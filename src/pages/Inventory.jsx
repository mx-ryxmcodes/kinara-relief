import { useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { CATEGORIES, PRIORITIES } from '../logic/constants.js';
import { can } from '../logic/permissions.js';
import { availableStock, isLowStock, needProgress, reservedForItem } from '../logic/rules.js';
import { validateItem } from '../logic/validators.js';
import { Badge, ConfirmDialog, EmptyState, Field, FormError, Meter, Modal, PageHeader, reportFormError } from '../components/ui.jsx';
import { fmt, plural } from '../lib/format.js';

function ItemForm({ item, onClose }) {
  const { run } = useApp();
  const formId = useId();
  const [values, setValues] = useState({
    name: item?.name ?? '',
    category: item?.category ?? '',
    unit: item?.unit ?? '',
    stock: item?.stock ?? '',
    reorder_level: item?.reorder_level ?? '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const check = validateItem(values);
    if (!check.ok) {
      setErrors(check.errors);
      setFormError('');
      return;
    }
    setBusy(true);
    const outcome = await run(
      (a) => (item ? a.updateItem(item.id, values) : a.createItem(values)),
      `${check.value.name} ${item ? 'saved' : 'added'}.`,
      { inline: true },
    );
    setBusy(false);
    if (outcome.ok) onClose();
    else reportFormError(outcome.error, setErrors, setFormError);
  }

  return (
    <Modal
      title={item ? 'Edit item' : 'Add item'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Saving' : 'Save item'}</button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <FormError>{formError}</FormError>
        <Field label="Item name" error={errors.name}>
          {(p) => <input {...p} value={values.name} onChange={set('name')} autoComplete="off" />}
        </Field>
        <div className="form-grid">
          <Field label="Category" error={errors.category}>
            {(p) => (
              <select {...p} value={values.category} onChange={set('category')}>
                <option value="">Choose a category</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </Field>
          <Field label="Unit" error={errors.unit} hint="For example kg, litres or kits.">
            {(p) => <input {...p} value={values.unit} onChange={set('unit')} autoComplete="off" />}
          </Field>
          <Field label="Stock in warehouse" error={errors.stock}>
            {(p) => <input {...p} type="number" min="0" inputMode="numeric" value={values.stock} onChange={set('stock')} />}
          </Field>
          <Field label="Reorder level" error={errors.reorder_level} hint="At or below this, the item shows as Low Stock.">
            {(p) => <input {...p} type="number" min="0" inputMode="numeric" value={values.reorder_level} onChange={set('reorder_level')} />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export default function Inventory() {
  const { data, role, run, lookups } = useApp();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [category, setCategory] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [lowOnly, setLowOnly] = useState(false);
  const [form, setForm] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = can(role, 'inventory.write');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.inventory
      .map((item) => ({
        item,
        reserved: reservedForItem(item.id, data.needs, data.dispatches),
        available: availableStock(item, data.needs, data.dispatches),
        low: isLowStock(item),
      }))
      .filter((r) => category === 'All' || r.item.category === category)
      .filter((r) => !lowOnly || r.low)
      .filter((r) => !q || r.item.name.toLowerCase().includes(q));
  }, [data.inventory, data.needs, data.dispatches, query, category, lowOnly]);

  const lowCount = data.inventory.filter(isLowStock).length;

  const needRows = useMemo(() => {
    const order = { High: 0, Medium: 1, Low: 2 };
    return data.needs
      .filter((n) => priorityFilter === 'All' || n.priority === priorityFilter)
      .map((n) => ({ need: n, camp: lookups.camps.get(n.camp_id), item: lookups.items.get(n.inventory_item_id), progress: needProgress(n) }))
      .filter((r) => r.camp && r.item)
      .sort((a, b) => order[a.need.priority] - order[b.need.priority] || a.progress - b.progress || a.need.id - b.need.id);
  }, [data.needs, lookups, priorityFilter]);

  async function removeItem() {
    setBusy(true);
    await run((a) => a.deleteItem(removing.id), `${removing.name} deleted.`);
    setBusy(false);
    setRemoving(null);
  }

  return (
    <>
      <PageHeader eyebrow="Warehouse and demand"
        title="Inventory"
        intro={lowCount ? `${plural(lowCount, 'item')} at or below the reorder level.` : 'Every item is above its reorder level.'}
        actions={isAdmin && <button type="button" className="btn btn-primary" onClick={() => setForm({ item: null })}>Add item</button>}
      />

      <div className="toolbar">
        <input type="search" aria-label="Search inventory" placeholder="Search items" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="All">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low Stock only
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No items match">Clear the search or filters to see the full warehouse list.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Warehouse inventory</caption>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th className="num">In stock</th>
                <th className="num">Reserved</th>
                <th className="num">Available</th>
                <th className="num">Reorder level</th>
                <th>Stock level</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, reserved, available, low }) => (
                <tr key={item.id}>
                  <td className="strong">{item.name}<span className="cell-sub">{item.unit}</span></td>
                  <td>{item.category}</td>
                  <td className="num">{fmt(item.stock)}</td>
                  <td className="num">{fmt(reserved)}</td>
                  <td className="num">{fmt(available)}</td>
                  <td className="num">{fmt(item.reorder_level)}</td>
                  <td>{low ? <Badge label="Low Stock" /> : <Badge label="OK" tone="good" />}</td>
                  {isAdmin && (
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn btn-small" onClick={() => setForm({ item })}>Edit</button>
                        <button type="button" className="btn btn-small" onClick={() => setRemoving(item)}>Delete</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="table-note">Reserved stock is held for Pending and In Transit dispatches. It leaves the warehouse when a dispatch is marked Delivered.</p>

      <section className="section" aria-labelledby="needs-panel-title">
        <div className="section-head">
          <h2 id="needs-panel-title">Camp needs</h2>
          <select aria-label="Filter needs by priority" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="All">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {needRows.length === 0 ? (
          <EmptyState title="No needs match">Choose a different priority.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Camp needs</caption>
              <thead>
                <tr>
                  <th>Camp</th>
                  <th>Item</th>
                  <th>Priority</th>
                  <th className="num">Required</th>
                  <th className="num">Fulfilled</th>
                  <th>Fulfilment</th>
                </tr>
              </thead>
              <tbody>
                {needRows.map(({ need, camp, item, progress }) => (
                  <tr key={need.id}>
                    <td className="strong"><Link to={`/camps/${camp.id}?need=${need.id}`}>{camp.name}</Link><span className="cell-sub">{camp.district}</span></td>
                    <td>{item.name}<span className="cell-sub">{item.unit}</span></td>
                    <td><Badge label={need.priority} /></td>
                    <td className="num">{fmt(need.required_quantity)}</td>
                    <td className="num">{fmt(need.fulfilled_quantity)}</td>
                    <td><Meter value={progress} priority={need.priority} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="legend"><span className="legend-line" aria-hidden="true" /> Fulfilled ÷ required. The line marks 40%.</p>
      </section>

      {form && <ItemForm item={form.item} onClose={() => setForm(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Delete ${removing.name}?`}
          message="Items used by camp needs or recorded in donations cannot be deleted."
          confirmLabel="Delete item"
          danger
          busy={busy}
          onConfirm={removeItem}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  );
}
