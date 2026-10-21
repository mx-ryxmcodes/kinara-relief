// API-backed actions. Every rule that protects data lives here, not in the UI.
//
// JSON Server has no transactions, so each action re-reads the records it
// depends on, re-checks the rules, and then writes in a fixed order. For Mark
// Delivered that order is stock, need, then dispatch status, so a failure part
// way through errs toward under-dispatching, never over-dispatching.
import { ApiError } from '../api/client.js';
import {
  availableStock,
  isActiveDispatch,
  remainingForNeed,
  reservedForItem,
  reservedForNeed,
  resolveCampStatus,
} from './rules.js';
import {
  toInt,
  validateCamp,
  validateDispatchInput,
  validateDonation,
  validateItem,
  validateNeed,
  validateVolunteer,
} from './validators.js';

// A broken rule the user can fix. `fields` maps form fields to messages.
export class RuleError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'RuleError';
    this.fields = fields;
  }
}

export const errorMessage = (err) =>
  err instanceof RuleError || err instanceof ApiError ? err.message : 'Something went wrong. Try again.';

function assertValid(result) {
  if (!result.ok) throw new RuleError(Object.values(result.errors)[0], result.errors);
  return result.value;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function createActions(api) {
  async function find(collection, id, label) {
    try {
      return await api.get(collection, id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw new RuleError(`${label} no longer exists.`);
      throw err;
    }
  }

  async function unassignVolunteers(campId) {
    const volunteers = await api.list('volunteers');
    const assigned = volunteers.filter((v) => v.camp_id === campId);
    for (const v of assigned) await api.patch('volunteers', v.id, { camp_id: null });
    return assigned.length;
  }

  return {
    // ---------- Camps ----------
    async createCamp(input) {
      return api.create('camps', assertValid(validateCamp(input)));
    },

    async updateCamp(id, input) {
      const value = assertValid(validateCamp(input));
      const existing = await find('camps', id, 'This camp');
      const camp = await api.patch('camps', id, value);
      let unassigned = 0;
      if (value.status === 'Closed' && existing.status !== 'Closed') unassigned = await unassignVolunteers(id);
      return { camp, unassigned };
    },

    // Field Volunteers may update families only.
    async updateCampFamilies(id, families) {
      const existing = await find('camps', id, 'This camp');
      const value = assertValid(validateCamp({ ...existing, current_families: families }));
      return api.patch('camps', id, { current_families: value.current_families, status: value.status });
    },

    async setCampClosed(id, closed) {
      const existing = await find('camps', id, 'This camp');
      if (closed) {
        const camp = await api.patch('camps', id, { status: 'Closed' });
        const unassigned = await unassignVolunteers(id);
        return { camp, unassigned };
      }
      const status = resolveCampStatus({ ...existing, status: 'Active' });
      return { camp: await api.patch('camps', id, { status }), unassigned: 0 };
    },

    async deleteCamp(id) {
      await find('camps', id, 'This camp');
      const dispatches = (await api.list('dispatches')).filter((d) => d.camp_id === id);
      if (dispatches.some(isActiveDispatch)) {
        throw new RuleError('This camp has Pending or In Transit dispatches. Deliver or cancel them first.');
      }
      const needs = (await api.list('needs')).filter((n) => n.camp_id === id);
      for (const d of dispatches) await api.remove('dispatches', d.id);
      for (const n of needs) await api.remove('needs', n.id);
      await unassignVolunteers(id);
      await api.remove('camps', id);
    },

    // ---------- Inventory ----------
    async createItem(input) {
      return api.create('inventory', assertValid(validateItem(input)));
    },

    async updateItem(id, input) {
      const value = assertValid(validateItem(input));
      const existing = await find('inventory', id, 'This item');
      const [needs, dispatches] = await Promise.all([api.list('needs'), api.list('dispatches')]);
      const reserved = reservedForItem(id, needs, dispatches);
      if (value.stock < reserved) {
        const message = `Stock cannot be below ${reserved} ${existing.unit}, which is already reserved for dispatches.`;
        throw new RuleError(message, { stock: message });
      }
      return api.patch('inventory', id, value);
    },

    async deleteItem(id) {
      await find('inventory', id, 'This item');
      const [needs, donations] = await Promise.all([api.list('needs'), api.list('donations')]);
      if (needs.some((n) => n.inventory_item_id === id)) {
        throw new RuleError('This item is used by camp needs. Remove those needs first.');
      }
      if (donations.some((d) => d.type === 'In-Kind' && d.item_id === id)) {
        throw new RuleError('This item appears in donation records, so it cannot be deleted.');
      }
      await api.remove('inventory', id);
    },

    // ---------- Needs ----------
    async createNeed(input) {
      const value = assertValid(validateNeed(input));
      const campId = toInt(input.camp_id);
      if (Number.isNaN(campId)) throw new RuleError('Choose a camp.');
      await find('camps', campId, 'The camp');
      await find('inventory', value.inventory_item_id, 'The inventory item');
      const needs = await api.list('needs');
      if (needs.some((n) => n.camp_id === campId && n.inventory_item_id === value.inventory_item_id)) {
        const message = 'This camp already has a need for that item. Edit it instead.';
        throw new RuleError(message, { inventory_item_id: message });
      }
      return api.create('needs', { camp_id: campId, ...value, fulfilled_quantity: 0 });
    },

    async updateNeed(id, input) {
      const value = assertValid(validateNeed(input));
      const need = await find('needs', id, 'This need');
      if (value.inventory_item_id !== need.inventory_item_id) {
        throw new RuleError('The item of an existing need cannot be changed. Remove the need and add a new one.');
      }
      const dispatches = await api.list('dispatches');
      const floor = need.fulfilled_quantity + reservedForNeed(id, dispatches);
      if (value.required_quantity < floor) {
        const message = `Required quantity cannot be below ${floor} (already fulfilled plus reserved for dispatches).`;
        throw new RuleError(message, { required_quantity: message });
      }
      return api.patch('needs', id, { required_quantity: value.required_quantity, priority: value.priority });
    },

    async deleteNeed(id) {
      await find('needs', id, 'This need');
      const dispatches = (await api.list('dispatches')).filter((d) => d.need_id === id);
      if (dispatches.some(isActiveDispatch)) {
        throw new RuleError('This need has Pending or In Transit dispatches. Deliver or cancel them first.');
      }
      for (const d of dispatches) await api.remove('dispatches', d.id);
      await api.remove('needs', id);
    },

    // ---------- Dispatches ----------
    async createDispatch(input) {
      const value = assertValid(validateDispatchInput(input));
      const camp = await find('camps', value.camp_id, 'The camp');
      if (resolveCampStatus(camp) === 'Closed') throw new RuleError('This camp is Closed and cannot receive dispatches.');
      const need = await find('needs', value.need_id, 'The need');
      if (need.camp_id !== camp.id) throw new RuleError('That need belongs to a different camp.');
      const [item, needs, dispatches] = await Promise.all([
        find('inventory', need.inventory_item_id, 'The inventory item'),
        api.list('needs'),
        api.list('dispatches'),
      ]);

      const available = Math.max(0, availableStock(item, needs, dispatches));
      if (value.quantity > available) {
        const message = `Only ${available} ${item.unit} of ${item.name} is available in the warehouse.`;
        throw new RuleError(message, { quantity: message });
      }
      const remaining = Math.max(0, remainingForNeed(need, dispatches));
      if (value.quantity > remaining) {
        const message = `This need has only ${remaining} ${item.unit} left unreserved.`;
        throw new RuleError(message, { quantity: message });
      }
      return api.create('dispatches', {
        camp_id: camp.id,
        need_id: need.id,
        quantity: value.quantity,
        status: 'Pending',
      });
    },

    async markInTransit(id) {
      const d = await find('dispatches', id, 'This dispatch');
      if (d.status !== 'Pending') {
        throw new RuleError(`Only Pending dispatches can be marked In Transit. This one is ${d.status}.`);
      }
      return api.patch('dispatches', id, { status: 'In Transit' });
    },

    async markDelivered(id) {
      const d = await find('dispatches', id, 'This dispatch');
      if (d.status !== 'In Transit') {
        throw new RuleError(`Only In Transit dispatches can be marked Delivered. This one is ${d.status}.`);
      }
      const need = await find('needs', d.need_id, 'The need');
      const item = await find('inventory', need.inventory_item_id, 'The inventory item');
      if (item.stock < d.quantity) {
        throw new RuleError(`Warehouse stock (${item.stock}) is lower than this dispatch (${d.quantity}). Correct the inventory first.`);
      }
      if (need.fulfilled_quantity + d.quantity > need.required_quantity) {
        throw new RuleError('Delivering this would exceed the quantity the camp needs. Cancel the dispatch or raise the need.');
      }
      await api.patch('inventory', item.id, { stock: item.stock - d.quantity });
      await api.patch('needs', need.id, { fulfilled_quantity: need.fulfilled_quantity + d.quantity });
      return api.patch('dispatches', id, { status: 'Delivered' });
    },

    async cancelDispatch(id) {
      const d = await find('dispatches', id, 'This dispatch');
      if (!isActiveDispatch(d)) {
        throw new RuleError(`Only Pending or In Transit dispatches can be cancelled. This one is ${d.status}.`);
      }
      return api.patch('dispatches', id, { status: 'Cancelled' });
    },

    // ---------- Donations ----------
    async createDonation(input) {
      const value = assertValid(validateDonation(input));
      value.date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : todayIso();
      if (value.type === 'Cash') return api.create('donations', { ...value, item_id: null });

      const item = await find('inventory', value.item_id, 'The inventory item');
      value.category = item.category;
      const created = await api.create('donations', value);
      try {
        await api.patch('inventory', item.id, { stock: item.stock + value.amount_or_quantity });
      } catch (err) {
        try { await api.remove('donations', created.id); } catch { /* best effort rollback */ }
        throw err;
      }
      return created;
    },

    // ---------- Volunteers ----------
    async createVolunteer(input) {
      return api.create('volunteers', { ...assertValid(validateVolunteer(input)), camp_id: null });
    },

    async updateVolunteer(id, input) {
      const value = assertValid(validateVolunteer(input));
      await find('volunteers', id, 'This volunteer');
      return api.patch('volunteers', id, value);
    },

    async deleteVolunteer(id) {
      await find('volunteers', id, 'This volunteer');
      await api.remove('volunteers', id);
    },

    async assignVolunteer(id, campId) {
      const targetId = toInt(campId);
      if (Number.isNaN(targetId)) throw new RuleError('Choose a camp.');
      await find('volunteers', id, 'This volunteer');
      const camp = await find('camps', targetId, 'The camp');
      if (resolveCampStatus(camp) === 'Closed') throw new RuleError('Closed camps cannot receive volunteers.');
      return api.patch('volunteers', id, { camp_id: targetId });
    },

    async unassignVolunteer(id) {
      await find('volunteers', id, 'This volunteer');
      return api.patch('volunteers', id, { camp_id: null });
    },
  };
}
