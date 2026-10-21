import { describe, expect, it } from 'vitest';
import { buildSeed } from '../server/seed.js';
import { checkSeed } from '../server/check-seed.js';
import {
  availableStock,
  campUnderservedScores,
  criticalGaps,
  dashboardKpis,
  donationTotals,
  fulfilmentByCategory,
  isCriticalGap,
  isLowStock,
  maxDispatchQuantity,
  needProgress,
  overallFulfilment,
  remainingForNeed,
  resolveCampStatus,
  underservedCampIds,
} from '../src/logic/rules.js';
import { toInt, validateCamp, validateDonation, validateItem, validateNeed } from '../src/logic/validators.js';
import { can, COORDINATOR, FIELD_VOLUNTEER } from '../src/logic/permissions.js';

const seed = buildSeed();
const need = (id) => seed.needs.find((n) => n.id === id);
const item = (id) => seed.inventory.find((i) => i.id === id);

describe('seed data', () => {
  it('meets the brief and the PRD consistency rules', () => {
    expect(checkSeed(seed)).toEqual([]);
  });
});

describe('camp status', () => {
  it('becomes Full when families reach capacity', () => {
    expect(resolveCampStatus({ status: 'Active', capacity: 100, current_families: 100 })).toBe('Full');
    expect(resolveCampStatus({ status: 'Active', capacity: 100, current_families: 140 })).toBe('Full');
  });
  it('returns to Active below capacity', () => {
    expect(resolveCampStatus({ status: 'Full', capacity: 100, current_families: 99 })).toBe('Active');
  });
  it('keeps Closed no matter the numbers', () => {
    expect(resolveCampStatus({ status: 'Closed', capacity: 100, current_families: 100 })).toBe('Closed');
    expect(resolveCampStatus({ status: 'Closed', capacity: 100, current_families: 0 })).toBe('Closed');
  });
});

describe('inventory', () => {
  it('flags Low Stock at or below the reorder level', () => {
    expect(isLowStock({ stock: 800, reorder_level: 800 })).toBe(true);
    expect(isLowStock({ stock: 801, reorder_level: 800 })).toBe(false);
    expect(isLowStock({ stock: 0, reorder_level: 0 })).toBe(true);
  });
  it('subtracts Pending and In Transit reservations from stock', () => {
    // Item 4 (water): 12000 in stock, 800 In Transit + 400 Pending reserved.
    expect(availableStock(item(4), seed.needs, seed.dispatches)).toBe(12000 - 1200);
  });
  it('ignores Delivered and Cancelled dispatches', () => {
    // Item 8 (first aid kits): only a Cancelled dispatch exists.
    expect(availableStock(item(8), seed.needs, seed.dispatches)).toBe(90);
  });
});

describe('need progress and limits', () => {
  it('computes fulfilled divided by required', () => {
    expect(needProgress(need(1))).toBeCloseTo(0.75);
    expect(needProgress({ required_quantity: 0, fulfilled_quantity: 0 })).toBe(0);
  });
  it('treats exactly 40% as not critical and 0% High as critical', () => {
    expect(needProgress(need(4))).toBeCloseTo(0.4);
    expect(isCriticalGap(need(4))).toBe(false);
    expect(isCriticalGap(need(9))).toBe(true);
  });
  it('never marks Medium or Low priority needs as critical', () => {
    expect(isCriticalGap({ priority: 'Medium', required_quantity: 10, fulfilled_quantity: 0 })).toBe(false);
    expect(isCriticalGap({ priority: 'Low', required_quantity: 10, fulfilled_quantity: 0 })).toBe(false);
  });
  it('remaining = required - fulfilled - other active dispatches', () => {
    expect(remainingForNeed(need(15), seed.dispatches)).toBe(3000 - 2100 - 400);
    expect(remainingForNeed(need(15), seed.dispatches, 7)).toBe(3000 - 2100);
  });
  it('limits a dispatch to the smaller of stock and need', () => {
    expect(maxDispatchQuantity(need(12), item(5), seed.needs, seed.dispatches)).toBe(50);
    expect(maxDispatchQuantity(need(9), item(2), seed.needs, seed.dispatches)).toBe(200);
  });
});

describe('dashboard numbers', () => {
  it('computes the five KPIs', () => {
    const k = dashboardKpis(seed);
    expect(k.activeCamps).toBe(7);
    expect(k.families).toBe(1885);
    expect(k.lowStock).toBe(3);
    expect(k.volunteersDeployed).toBe(11);
    expect(k.fulfilment).toBeCloseTo(0.4996, 3);
  });
  it('excludes needs of Closed camps from fulfilment', () => {
    const withClosedGap = [...seed.needs, { id: 99, camp_id: 8, inventory_item_id: 9, required_quantity: 100, priority: 'High', fulfilled_quantity: 0 }];
    expect(overallFulfilment(withClosedGap, seed.camps)).toBeCloseTo(overallFulfilment(seed.needs, seed.camps), 6);
  });
  it('averages progress per category', () => {
    const rows = fulfilmentByCategory(seed.needs, seed.camps, seed.inventory);
    const by = Object.fromEntries(rows.map((r) => [r.category, r.percent]));
    expect(by.Hygiene).toBe(30);
    expect(by.Food).toBe(42);
    expect(rows.map((r) => r.category)).toEqual(['Food', 'Water', 'Medical', 'Shelter', 'Hygiene']);
  });
  it('lists critical gaps worst first', () => {
    const rows = criticalGaps(seed.needs, seed.camps, seed.inventory);
    expect(rows.map((r) => r.need.id)).toEqual([9, 6, 2, 12, 19]);
    expect(rows.every((r) => r.need.priority === 'High' && r.progress < 0.4)).toBe(true);
    expect(rows[0].camp.name).toBe('Larkana Stadium Camp');
  });
  it('ranks underserved camps by priority-weighted gap', () => {
    const scores = campUnderservedScores(seed.camps, seed.needs);
    expect(scores.map((s) => s.camp.id).slice(0, 3)).toEqual([3, 1, 5]);
    expect(scores.find((s) => s.camp.id === 8)).toBeUndefined();
    expect([...underservedCampIds(seed.camps, seed.needs)].sort()).toEqual([1, 3, 5]);
  });
  it('totals cash and counts In-Kind donations per category', () => {
    const t = donationTotals(seed.donations);
    expect(t.totalCash).toBe(1300000);
    const food = t.byCategory.find((c) => c.category === 'Food');
    expect(food).toEqual({ category: 'Food', cash: 500000, inKindCount: 1 });
  });
});

describe('validators', () => {
  it('parses whole numbers only', () => {
    expect(toInt('12')).toBe(12);
    expect(Number.isNaN(toInt('1.5'))).toBe(true);
    expect(Number.isNaN(toInt(''))).toBe(true);
    expect(Number.isNaN(toInt('abc'))).toBe(true);
  });
  it('validates a camp and resolves its status', () => {
    const bad = validateCamp({ name: '', district: '', capacity: '0', current_families: '-1' });
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(['capacity', 'current_families', 'district', 'name']);
    const full = validateCamp({ name: ' Test Camp ', district: 'Dadu', capacity: '50', current_families: '50', status: 'Active' });
    expect(full.ok).toBe(true);
    expect(full.value).toMatchObject({ name: 'Test Camp', capacity: 50, current_families: 50, status: 'Full' });
    expect(validateCamp({ name: 'Test', district: 'Dadu', capacity: 50, current_families: 5, status: 'Closed' }).value.status).toBe('Closed');
  });
  it('validates inventory items', () => {
    expect(validateItem({ name: 'Salt', category: 'Food', unit: 'kg', stock: '10', reorder_level: '2' }).ok).toBe(true);
    const bad = validateItem({ name: '', category: 'Toys', unit: '', stock: '-1', reorder_level: 'x' });
    expect(Object.keys(bad.errors).sort()).toEqual(['category', 'name', 'reorder_level', 'stock', 'unit']);
  });
  it('validates needs', () => {
    expect(validateNeed({ inventory_item_id: '3', required_quantity: '10', priority: 'High' }).ok).toBe(true);
    expect(validateNeed({ inventory_item_id: '', required_quantity: '0', priority: 'Urgent' }).ok).toBe(false);
  });
  it('validates Cash and In-Kind donations differently', () => {
    expect(validateDonation({ type: 'Cash', amount_or_quantity: '5000', category: 'Food' }).ok).toBe(true);
    expect(validateDonation({ type: 'Cash', amount_or_quantity: '0', category: 'Food' }).errors.amount_or_quantity).toBeTruthy();
    expect(validateDonation({ type: 'In-Kind', amount_or_quantity: '5', item_id: '' }).errors.item_id).toBeTruthy();
    const ok = validateDonation({ type: 'In-Kind', amount_or_quantity: '5', item_id: '2' });
    expect(ok.ok).toBe(true);
    expect(ok.value.item_id).toBe(2);
  });
});

describe('permissions', () => {
  it('follows the PRD matrix', () => {
    expect(can(COORDINATOR, 'camp.write')).toBe(true);
    expect(can(FIELD_VOLUNTEER, 'camp.write')).toBe(false);
    expect(can(FIELD_VOLUNTEER, 'camp.families')).toBe(true);
    expect(can(FIELD_VOLUNTEER, 'dispatch.deliver')).toBe(true);
    expect(can(FIELD_VOLUNTEER, 'dispatch.create')).toBe(false);
    expect(can(FIELD_VOLUNTEER, 'donation.write')).toBe(false);
    expect(can(FIELD_VOLUNTEER, 'volunteer.assign')).toBe(false);
    expect(can(COORDINATOR, 'unknown.capability')).toBe(false);
  });
});
