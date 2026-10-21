// Verifies a database (default: db.json) against the brief's seed counts and
// the PRD's consistency rules. Exit code 1 when anything fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSeed } from './seed.js';
import {
  availableStock,
  criticalGaps,
  isLowStock,
  isActiveDispatch,
  needProgress,
  remainingForNeed,
  resolveCampStatus,
} from '../src/logic/rules.js';

export function checkSeed(db) {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  const { camps, inventory, needs, dispatches, donations, volunteers } = db;

  // Counts and mixes required by the brief
  if (camps.length !== 8) fail(`Expected 8 camps, found ${camps.length}`);
  if (new Set(camps.map((c) => c.district)).size < 4) fail('Camps must span at least 4 districts');
  if (camps.filter((c) => c.status === 'Full').length < 1) fail('Need at least one Full camp');
  if (camps.filter((c) => c.status === 'Closed').length < 1) fail('Need at least one Closed camp');
  if (inventory.length !== 12) fail(`Expected 12 inventory items, found ${inventory.length}`);
  if (inventory.filter(isLowStock).length < 2) fail('Need at least 2 Low Stock items');
  if (needs.length !== 20) fail(`Expected 20 needs, found ${needs.length}`);
  if (criticalGaps(needs, camps, inventory).length < 3) fail('Need at least 3 Critical Gaps');
  if (dispatches.length !== 10) fail(`Expected 10 dispatches, found ${dispatches.length}`);
  if (donations.length !== 10) fail(`Expected 10 donations, found ${donations.length}`);
  if (volunteers.length !== 15) fail(`Expected 15 volunteers, found ${volunteers.length}`);
  for (const status of ['Pending', 'In Transit', 'Delivered', 'Cancelled']) {
    if (!dispatches.some((d) => d.status === status)) fail(`No ${status} dispatch in the seed`);
  }
  for (const type of ['Cash', 'In-Kind']) {
    if (!donations.some((d) => d.type === type)) fail(`No ${type} donation in the seed`);
  }
  for (const skill of ['Medical', 'Logistics', 'Cooking', 'Driving', 'Counselling']) {
    if (!volunteers.some((v) => v.skill === skill)) fail(`No ${skill} volunteer in the seed`);
  }
  if (!volunteers.some((v) => v.camp_id == null)) fail('Need some unassigned volunteers');

  // Consistency rules
  const campById = new Map(camps.map((c) => [c.id, c]));
  const itemById = new Map(inventory.map((i) => [i.id, i]));
  const needById = new Map(needs.map((n) => [n.id, n]));

  for (const c of camps) {
    if (c.status === 'Full' && !(c.current_families >= c.capacity)) fail(`Camp ${c.id} is Full but under capacity`);
    if (c.status === 'Active' && resolveCampStatus(c) !== 'Active') fail(`Camp ${c.id} is Active but at capacity`);
  }
  const seen = new Set();
  for (const n of needs) {
    if (!campById.has(n.camp_id)) fail(`Need ${n.id} points to a missing camp`);
    if (!itemById.has(n.inventory_item_id)) fail(`Need ${n.id} points to a missing item`);
    const key = `${n.camp_id}:${n.inventory_item_id}`;
    if (seen.has(key)) fail(`Camp ${n.camp_id} has two needs for item ${n.inventory_item_id}`);
    seen.add(key);
    if (n.fulfilled_quantity > n.required_quantity) fail(`Need ${n.id} is over-fulfilled`);
    const delivered = dispatches
      .filter((d) => d.need_id === n.id && d.status === 'Delivered')
      .reduce((s, d) => s + d.quantity, 0);
    if (n.fulfilled_quantity < delivered) fail(`Need ${n.id} fulfilled is below its Delivered dispatches`);
    if (remainingForNeed(n, dispatches) < 0) fail(`Need ${n.id} is over-reserved`);
    const progress = needProgress(n);
    const camp = campById.get(n.camp_id);
    if (camp?.status === 'Closed' && n.priority === 'High' && progress < 0.4) fail(`Closed camp ${camp.id} has a Critical Gap`);
  }
  for (const d of dispatches) {
    const need = needById.get(d.need_id);
    if (!need) { fail(`Dispatch ${d.id} points to a missing need`); continue; }
    if (need.camp_id !== d.camp_id) fail(`Dispatch ${d.id} camp does not match its need's camp`);
    const camp = campById.get(d.camp_id);
    if (camp?.status === 'Closed' && isActiveDispatch(d)) fail(`Closed camp ${camp.id} has an active dispatch`);
  }
  for (const item of inventory) {
    if (availableStock(item, needs, dispatches) < 0) fail(`Item ${item.id} is over-reserved`);
  }
  for (const v of volunteers) {
    if (v.camp_id != null) {
      const camp = campById.get(v.camp_id);
      if (!camp) fail(`Volunteer ${v.id} points to a missing camp`);
      else if (camp.status === 'Closed') fail(`Volunteer ${v.id} is assigned to a Closed camp`);
    }
  }
  for (const d of donations) {
    if (d.type === 'In-Kind') {
      const item = itemById.get(d.item_id);
      if (!item) fail(`Donation ${d.id} points to a missing item`);
      else if (item.category !== d.category) fail(`Donation ${d.id} category does not match its item`);
    }
  }
  return problems;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const path = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'db.json');
  let db;
  try {
    db = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.log(`No ${path} found, checking the built-in seed instead.`);
    db = buildSeed();
  }
  const problems = checkSeed(db);
  if (problems.length) {
    console.error('Seed check failed:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  console.log('Seed check passed: counts, mixes and consistency rules all hold.');
}
