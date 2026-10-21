// Pure business rules. No fetch, no React. Every derived number in the app
// (status, low stock, available stock, progress, gaps, KPIs) comes from here
// and is never stored in the database.
import {
  ACTIVE_DISPATCH_STATUSES,
  CATEGORIES,
  CRITICAL_THRESHOLD,
  PRIORITY_WEIGHT,
  UNDERSERVED_COUNT,
} from './constants.js';

export const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const byId = (list) => new Map(list.map((x) => [x.id, x]));

// ---------- Camps ----------

// Closed is manual and sticky. Otherwise Full when families reach capacity.
export function resolveCampStatus(camp) {
  if (camp.status === 'Closed') return 'Closed';
  return num(camp.current_families) >= num(camp.capacity) ? 'Full' : 'Active';
}

export const isOpenCamp = (camp) => resolveCampStatus(camp) !== 'Closed';
export const isOverCapacity = (camp) => num(camp.current_families) > num(camp.capacity);

// ---------- Inventory ----------

export const isLowStock = (item) => num(item.stock) <= num(item.reorder_level);
export const isActiveDispatch = (d) => ACTIVE_DISPATCH_STATUSES.includes(d.status);

// Sum of Pending and In Transit dispatch quantities that draw on this item.
export function reservedForItem(itemId, needs, dispatches) {
  const needIds = new Set(needs.filter((n) => n.inventory_item_id === itemId).map((n) => n.id));
  return dispatches
    .filter((d) => isActiveDispatch(d) && needIds.has(d.need_id))
    .reduce((sum, d) => sum + num(d.quantity), 0);
}

export const availableStock = (item, needs, dispatches) =>
  num(item.stock) - reservedForItem(item.id, needs, dispatches);

// ---------- Needs ----------

export function reservedForNeed(needId, dispatches, excludeDispatchId = null) {
  return dispatches
    .filter((d) => d.need_id === needId && isActiveDispatch(d) && d.id !== excludeDispatchId)
    .reduce((sum, d) => sum + num(d.quantity), 0);
}

// required - fulfilled - other Pending/In Transit dispatches
export const remainingForNeed = (need, dispatches, excludeDispatchId = null) =>
  num(need.required_quantity) - num(need.fulfilled_quantity) - reservedForNeed(need.id, dispatches, excludeDispatchId);

export function needProgress(need) {
  const required = num(need.required_quantity);
  if (required <= 0) return 0;
  return Math.min(1, Math.max(0, num(need.fulfilled_quantity) / required));
}

export const needGap = (need) => 1 - needProgress(need);
export const isCriticalGap = (need) => need.priority === 'High' && needProgress(need) < CRITICAL_THRESHOLD;

// The most a new dispatch may carry: limited by stock and by the need.
export function maxDispatchQuantity(need, item, needs, dispatches) {
  const stockLimit = availableStock(item, needs, dispatches);
  const needLimit = remainingForNeed(need, dispatches);
  return Math.max(0, Math.min(stockLimit, needLimit));
}

export const percent = (fraction) => Math.round(fraction * 100);

// ---------- Dashboard ----------

export function needsOfOpenCamps(needs, camps) {
  const open = new Set(camps.filter(isOpenCamp).map((c) => c.id));
  return needs.filter((n) => open.has(n.camp_id));
}

// Average of per-need progress, so a need for 10 tents counts the same as a
// need for 10,000 bottles. Needs of Closed camps are excluded.
export function overallFulfilment(needs, camps) {
  const list = needsOfOpenCamps(needs, camps);
  if (list.length === 0) return 0;
  return list.reduce((sum, n) => sum + needProgress(n), 0) / list.length;
}

export function fulfilmentByCategory(needs, camps, items) {
  const itemMap = byId(items);
  const groups = new Map();
  for (const need of needsOfOpenCamps(needs, camps)) {
    const category = itemMap.get(need.inventory_item_id)?.category;
    if (!category) continue;
    const g = groups.get(category) || { total: 0, count: 0 };
    g.total += needProgress(need);
    g.count += 1;
    groups.set(category, g);
  }
  const known = CATEGORIES.filter((c) => groups.has(c));
  const extra = [...groups.keys()].filter((c) => !CATEGORIES.includes(c)).sort();
  return [...known, ...extra].map((category) => {
    const g = groups.get(category);
    return { category, percent: percent(g.total / g.count), needCount: g.count };
  });
}

// High-priority needs under the threshold at open camps, worst gap first.
export function criticalGaps(needs, camps, items) {
  const campMap = byId(camps);
  const itemMap = byId(items);
  return needsOfOpenCamps(needs, camps)
    .filter(isCriticalGap)
    .map((need) => ({
      need,
      camp: campMap.get(need.camp_id),
      item: itemMap.get(need.inventory_item_id),
      progress: needProgress(need),
      gap: needGap(need),
      shortfall: num(need.required_quantity) - num(need.fulfilled_quantity),
    }))
    .sort((a, b) => b.gap - a.gap || b.shortfall - a.shortfall || a.need.id - b.need.id);
}

// Priority-weighted average gap per open camp (0 = fully served, 1 = nothing
// delivered). Camps with no needs are not scored.
export function campUnderservedScores(camps, needs) {
  return camps
    .filter(isOpenCamp)
    .map((camp) => {
      const own = needs.filter((n) => n.camp_id === camp.id);
      if (own.length === 0) return null;
      let weighted = 0;
      let weights = 0;
      for (const need of own) {
        const w = PRIORITY_WEIGHT[need.priority] ?? 1;
        weighted += w * needGap(need);
        weights += w;
      }
      return { camp, score: weighted / weights, needCount: own.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.camp.id - b.camp.id);
}

// The worst few camps are flagged as underserved.
export function underservedCampIds(camps, needs, count = UNDERSERVED_COUNT) {
  return new Set(
    campUnderservedScores(camps, needs)
      .filter((s) => s.score > 0)
      .slice(0, count)
      .map((s) => s.camp.id),
  );
}

export function dashboardKpis({ camps, inventory, needs, volunteers }) {
  const open = camps.filter(isOpenCamp);
  const campIds = new Set(camps.map((c) => c.id));
  return {
    activeCamps: open.length,
    families: open.reduce((sum, c) => sum + num(c.current_families), 0),
    fulfilment: overallFulfilment(needs, camps),
    lowStock: inventory.filter(isLowStock).length,
    volunteersDeployed: volunteers.filter((v) => v.camp_id != null && campIds.has(v.camp_id)).length,
  };
}

// ---------- Donations ----------

export function donationTotals(donations) {
  const cats = new Map();
  let totalCash = 0;
  const bucket = (category) => {
    if (!cats.has(category)) cats.set(category, { category, cash: 0, inKindCount: 0 });
    return cats.get(category);
  };
  for (const category of CATEGORIES) bucket(category);
  for (const d of donations) {
    const b = bucket(d.category);
    if (d.type === 'Cash') {
      b.cash += num(d.amount_or_quantity);
      totalCash += num(d.amount_or_quantity);
    } else {
      b.inKindCount += 1;
    }
  }
  return { totalCash, byCategory: [...cats.values()] };
}
