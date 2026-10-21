import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeServer } from './helpers/fakeServer.js';
import { createActions, RuleError } from '../src/logic/actions.js';
import { ApiError } from '../src/api/client.js';
import { availableStock } from '../src/logic/rules.js';

let server;
let actions;
beforeEach(() => {
  server = createFakeServer();
  actions = createActions(server.api);
});

const row = (collection, id) => server.db[collection].find((r) => r.id === id);
const available = (itemId) => availableStock(row('inventory', itemId), server.db.needs, server.db.dispatches);

describe('camps', () => {
  it('creates a camp and marks it Full when families reach capacity', async () => {
    const camp = await actions.createCamp({ name: 'New Camp', district: 'Badin', capacity: '40', current_families: '40', status: 'Active' });
    expect(camp.status).toBe('Full');
  });

  it('rejects invalid input with field messages', async () => {
    await expect(actions.createCamp({ name: '', district: '', capacity: '0', current_families: '1' })).rejects.toMatchObject({
      name: 'RuleError',
      fields: expect.objectContaining({ name: expect.any(String), capacity: expect.any(String) }),
    });
    expect(server.db.camps).toHaveLength(8);
  });

  it('flips between Active and Full as families change', async () => {
    const full = await actions.updateCampFamilies(1, 400);
    expect(full.status).toBe('Full');
    const active = await actions.updateCampFamilies(1, 399);
    expect(active.status).toBe('Active');
  });

  it('keeps a Closed camp Closed when families change', async () => {
    const result = await actions.updateCampFamilies(8, 200);
    expect(result.status).toBe('Closed');
  });

  it('closing a camp unassigns its volunteers; reopening resolves the status', async () => {
    const closed = await actions.setCampClosed(3, true);
    expect(closed.unassigned).toBe(3);
    expect(server.db.volunteers.filter((v) => v.camp_id === 3)).toHaveLength(0);
    const reopened = await actions.setCampClosed(3, false);
    expect(reopened.camp.status).toBe('Active');
    const reopenedFull = await actions.setCampClosed(8, false);
    expect(reopenedFull.camp.status).toBe('Active');
  });

  it('blocks deleting a camp that has active dispatches', async () => {
    await expect(actions.deleteCamp(1)).rejects.toBeInstanceOf(RuleError);
    expect(row('camps', 1)).toBeTruthy();
  });

  it('deletes a camp with its needs and unassigns its volunteers', async () => {
    await actions.assignVolunteer(12, 4);
    await actions.deleteCamp(4);
    expect(row('camps', 4)).toBeUndefined();
    expect(server.db.needs.filter((n) => n.camp_id === 4)).toHaveLength(0);
    expect(row('volunteers', 12).camp_id).toBeNull();
  });
});

describe('inventory', () => {
  it('will not set stock below what is reserved', async () => {
    // Item 4 has 1200 reserved by Pending and In Transit dispatches.
    const base = { name: 'Drinking water bottles', category: 'Water', unit: 'bottles', reorder_level: 5000 };
    await expect(actions.updateItem(4, { ...base, stock: '1000' })).rejects.toBeInstanceOf(RuleError);
    await expect(actions.updateItem(4, { ...base, stock: '1200' })).resolves.toBeTruthy();
  });

  it('blocks deleting an item used by a need, allows an unused one', async () => {
    await expect(actions.deleteItem(1)).rejects.toBeInstanceOf(RuleError);
    const created = await actions.createItem({ name: 'Salt', category: 'Food', unit: 'kg', stock: '10', reorder_level: '2' });
    await actions.deleteItem(created.id);
    expect(row('inventory', created.id)).toBeUndefined();
  });
});

describe('needs', () => {
  it('rejects a duplicate item for the same camp', async () => {
    await expect(actions.createNeed({ camp_id: 1, inventory_item_id: 1, required_quantity: '10', priority: 'High' })).rejects.toBeInstanceOf(RuleError);
  });

  it('creates a need with zero fulfilled', async () => {
    const created = await actions.createNeed({ camp_id: 4, inventory_item_id: 4, required_quantity: '500', priority: 'Medium' });
    expect(created).toMatchObject({ camp_id: 4, inventory_item_id: 4, required_quantity: 500, fulfilled_quantity: 0 });
  });

  it('will not lower the requirement below fulfilled plus reserved', async () => {
    // Need 15: 2100 fulfilled + 400 Pending reserved.
    await expect(actions.updateNeed(15, { inventory_item_id: 4, required_quantity: '2499', priority: 'High' })).rejects.toBeInstanceOf(RuleError);
    await expect(actions.updateNeed(15, { inventory_item_id: 4, required_quantity: '2500', priority: 'Low' })).resolves.toMatchObject({ priority: 'Low' });
  });

  it('blocks removing a need with active dispatches', async () => {
    await expect(actions.deleteNeed(15)).rejects.toBeInstanceOf(RuleError);
    await actions.deleteNeed(10);
    expect(row('needs', 10)).toBeUndefined();
  });
});

describe('dispatch creation', () => {
  it('never dispatches more than the warehouse has available', async () => {
    row('inventory', 4).stock = 1250; // 1200 reserved leaves 50
    await expect(actions.createDispatch({ camp_id: 1, need_id: 2, quantity: '51' })).rejects.toThrow(/Only 50 bottles/);
    await expect(actions.createDispatch({ camp_id: 1, need_id: 2, quantity: '50' })).resolves.toMatchObject({ status: 'Pending' });
    expect(available(4)).toBe(0);
  });

  it("never exceeds the need's remaining unreserved quantity", async () => {
    // Need 12: 500 required, 150 fulfilled, 300 reserved, so 50 left.
    await expect(actions.createDispatch({ camp_id: 5, need_id: 12, quantity: '51' })).rejects.toThrow(/50 strips left unreserved/);
    const ok = await actions.createDispatch({ camp_id: 5, need_id: 12, quantity: '50' });
    expect(ok).toMatchObject({ camp_id: 5, need_id: 12, quantity: 50, status: 'Pending' });
    await expect(actions.createDispatch({ camp_id: 5, need_id: 12, quantity: '1' })).rejects.toThrow(/0 strips left/);
  });

  it('reserves stock immediately without changing physical stock', async () => {
    const before = available(5);
    await actions.createDispatch({ camp_id: 5, need_id: 12, quantity: '20' });
    expect(row('inventory', 5).stock).toBe(800);
    expect(available(5)).toBe(before - 20);
  });

  it('rejects zero, fractional and missing quantities', async () => {
    for (const quantity of ['0', '1.5', '', 'abc']) {
      await expect(actions.createDispatch({ camp_id: 5, need_id: 12, quantity })).rejects.toBeInstanceOf(RuleError);
    }
    expect(server.db.dispatches).toHaveLength(10);
  });

  it('rejects a Closed camp and a mismatched camp and need', async () => {
    await expect(actions.createDispatch({ camp_id: 8, need_id: 20, quantity: '1' })).rejects.toThrow(/Closed/);
    await expect(actions.createDispatch({ camp_id: 1, need_id: 12, quantity: '1' })).rejects.toThrow(/different camp/);
  });
});

describe('dispatch lifecycle', () => {
  it('moves Pending to In Transit to Delivered and updates stock and fulfilment', async () => {
    await expect(actions.markDelivered(8)).rejects.toBeInstanceOf(RuleError); // still Pending
    await actions.markInTransit(8);
    expect(row('dispatches', 8).status).toBe('In Transit');
    await actions.markDelivered(8);
    expect(row('dispatches', 8).status).toBe('Delivered');
    expect(row('inventory', 5).stock).toBe(800 - 300);
    expect(row('needs', 12).fulfilled_quantity).toBe(150 + 300);
    // The reservation ended, so available equals stock again.
    expect(available(5)).toBe(500);
  });

  it('writes stock and need before the dispatch status', async () => {
    await actions.markInTransit(8);
    server.calls.length = 0;
    await actions.markDelivered(8);
    const writes = server.calls.filter((c) => c.startsWith('PATCH'));
    expect(writes).toEqual(['PATCH /inventory/5', 'PATCH /needs/12', 'PATCH /dispatches/8']);
  });

  it('errs toward under-dispatching when a write fails part way', async () => {
    await actions.markInTransit(8);
    const before = available(5);
    server.failNext((method, path) => method === 'PATCH' && path === '/needs/12');
    await expect(actions.markDelivered(8)).rejects.toBeInstanceOf(ApiError);
    expect(row('dispatches', 8).status).toBe('In Transit');
    expect(available(5)).toBeLessThanOrEqual(before);
  });

  it('cancelling an undelivered dispatch frees the reservation', async () => {
    const before = available(4);
    await actions.cancelDispatch(7); // Pending, 400 bottles
    expect(row('dispatches', 7).status).toBe('Cancelled');
    expect(available(4)).toBe(before + 400);
    await actions.cancelDispatch(6); // In Transit, 800 bottles
    expect(available(4)).toBe(before + 1200);
  });

  it('refuses to cancel Delivered or Cancelled dispatches', async () => {
    await expect(actions.cancelDispatch(1)).rejects.toBeInstanceOf(RuleError);
    await expect(actions.cancelDispatch(10)).rejects.toBeInstanceOf(RuleError);
    await expect(actions.markInTransit(1)).rejects.toBeInstanceOf(RuleError);
  });

  it('reports a missing dispatch as a rule error', async () => {
    await expect(actions.markInTransit(999)).rejects.toThrow(/no longer exists/);
  });
});

describe('donations', () => {
  it('increases stock for In-Kind donations and takes the item category', async () => {
    const donation = await actions.createDonation({ type: 'In-Kind', amount_or_quantity: '25', item_id: '12', category: 'Food', donor_name: 'Test donor', date: '2026-10-20' });
    expect(donation).toMatchObject({ type: 'In-Kind', item_id: 12, category: 'Hygiene', amount_or_quantity: 25, date: '2026-10-20' });
    expect(row('inventory', 12).stock).toBe(450 + 25);
  });

  it('leaves stock alone for Cash donations', async () => {
    const donation = await actions.createDonation({ type: 'Cash', amount_or_quantity: '75000', category: 'Water' });
    expect(donation).toMatchObject({ type: 'Cash', item_id: null, category: 'Water' });
    expect(server.db.inventory.map((i) => i.stock)).toEqual(buildStocks());
  });

  it('rolls the donation back if the stock update fails', async () => {
    server.failNext((method, path) => method === 'PATCH' && path === '/inventory/12');
    await expect(actions.createDonation({ type: 'In-Kind', amount_or_quantity: '25', item_id: '12' })).rejects.toBeInstanceOf(ApiError);
    expect(server.db.donations).toHaveLength(10);
    expect(row('inventory', 12).stock).toBe(450);
  });

  it('rejects bad donations', async () => {
    await expect(actions.createDonation({ type: 'In-Kind', amount_or_quantity: '0', item_id: '12' })).rejects.toBeInstanceOf(RuleError);
    await expect(actions.createDonation({ type: 'Cash', amount_or_quantity: '100', category: 'Toys' })).rejects.toBeInstanceOf(RuleError);
  });
});

function buildStocks() {
  return createFakeServer().db.inventory.map((i) => i.stock);
}

describe('volunteers', () => {
  it('registers a volunteer as unassigned', async () => {
    const v = await actions.createVolunteer({ name: 'New Person', skill: 'Cooking' });
    expect(v).toMatchObject({ name: 'New Person', skill: 'Cooking', camp_id: null });
  });

  it('keeps one assignment per volunteer when reassigned', async () => {
    await actions.assignVolunteer(1, 2);
    expect(row('volunteers', 1).camp_id).toBe(2);
    expect(server.db.volunteers.filter((v) => v.id === 1)).toHaveLength(1);
  });

  it('never assigns to a Closed camp', async () => {
    await expect(actions.assignVolunteer(12, 8)).rejects.toThrow(/Closed/);
    expect(row('volunteers', 12).camp_id).toBeNull();
  });

  it('unassigns by clearing camp_id', async () => {
    await actions.unassignVolunteer(1);
    expect(row('volunteers', 1).camp_id).toBeNull();
  });
});

describe('network failures', () => {
  it('explains an unreachable API', async () => {
    const { createApi } = await import('../src/api/client.js');
    const broken = createActions(createApi('http://nowhere.test', async () => { throw new TypeError('fetch failed'); }));
    await expect(broken.createCamp({ name: 'Camp', district: 'Dadu', capacity: '10', current_families: '1' })).rejects.toThrow(/Cannot connect to the server/);
  });
});
