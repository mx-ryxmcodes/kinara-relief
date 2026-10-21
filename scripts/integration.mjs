// End-to-end check against a RUNNING JSON Server (npm run api). It uses the
// same API client and actions as the app, over real HTTP, and restores the
// data it touched. Usage (coordinator account): RELIEF_USER=coordinator RELIEF_PASSWORD=... node scripts/integration.mjs [http://localhost:3001]
import { createApi } from '../src/api/client.js';
import { createActions, RuleError } from '../src/logic/actions.js';
import { createServerActions } from '../src/logic/serverActions.js';
import { availableStock } from '../src/logic/rules.js';
import { checkSeed } from '../server/check-seed.js';

const base = process.argv[2] || 'http://localhost:3001';
const [loginId, loginPassword] = [process.env.RELIEF_USER, process.env.RELIEF_PASSWORD];
if (!loginId || !loginPassword) {
  console.error('Set RELIEF_USER and RELIEF_PASSWORD to a Relief Coordinator account first.');
  process.exit(1);
}
let token = null;
const api = createApi(base, undefined, { getToken: () => token });
token = (await api.login(loginId, loginPassword)).token;
const actions = createServerActions(api, createActions(api)); // runs on the server when it supports it
let passed = 0;

const ok = (cond, label) => {
  if (!cond) throw new Error(`FAILED: ${label}`);
  passed += 1;
  console.log(`  ok  ${label}`);
};
const rejects = async (promise, pattern, label) => {
  try {
    await promise;
  } catch (err) {
    ok(err instanceof RuleError && pattern.test(err.message), `${label} (${err.message})`);
    return;
  }
  throw new Error(`FAILED: ${label} was accepted`);
};

const db = await api.loadAll();
const problems = checkSeed(db);
ok(problems.length === 0, 'the API serves the seed and it passes the seed check');
for (const [name, count] of [['camps', 8], ['inventory', 12], ['needs', 20], ['dispatches', 10], ['donations', 10], ['volunteers', 15]]) {
  ok(db[name].length === count, `${name} has ${count} records`);
}

const avail = async (itemId) => {
  const d = await api.loadAll();
  return availableStock(d.inventory.find((i) => i.id === itemId), d.needs, d.dispatches);
};

// Dispatch limits over real HTTP
await rejects(actions.createDispatch({ camp_id: 5, need_id: 12, quantity: 51 }), /left unreserved/, 'a dispatch above the need is refused');
const before = await avail(5);
const created = await actions.createDispatch({ camp_id: 5, need_id: 12, quantity: 50 });
ok(created.status === 'Pending' && created.id > 10, 'a valid dispatch is created as Pending');
ok((await avail(5)) === before - 50, 'creating it reserves stock immediately');
ok((await api.get('inventory', 5)).stock === 800, 'physical stock is unchanged until delivery');
await rejects(actions.createDispatch({ camp_id: 5, need_id: 12, quantity: 1 }), /left unreserved/, 'the need is now fully reserved');

// Lifecycle
await rejects(actions.markDelivered(created.id), /In Transit/, 'Pending cannot jump to Delivered');
await actions.markInTransit(created.id);
await actions.markDelivered(created.id);
const need = await api.get('needs', 12);
ok(need.fulfilled_quantity === 200, 'Delivered raises the need fulfilment');
ok((await api.get('inventory', 5)).stock === 750, 'Delivered lowers warehouse stock');
await rejects(actions.cancelDispatch(created.id), /can be cancelled/, 'a Delivered dispatch cannot be cancelled');

// Cancel frees the reservation
const second = await actions.createDispatch({ camp_id: 1, need_id: 3, quantity: 10 });
const mid = await avail(9);
await actions.cancelDispatch(second.id);
ok((await avail(9)) === mid + 10, 'cancelling restores available stock');

// Donations and volunteers
const stockBefore = (await api.get('inventory', 12)).stock;
const donation = await actions.createDonation({ type: 'In-Kind', amount_or_quantity: 25, item_id: 12 });
ok((await api.get('inventory', 12)).stock === stockBefore + 25, 'an In-Kind donation raises stock');
await rejects(actions.assignVolunteer(12, 8), /Closed/, 'a volunteer cannot be assigned to a Closed camp');
await actions.assignVolunteer(12, 4);
ok((await api.get('volunteers', 12)).camp_id === 4, 'a volunteer can be assigned to an open camp');

// Camp rules
const full = await actions.updateCampFamilies(1, 400);
ok(full.status === 'Full', 'families at capacity makes the camp Full');
const camp = await actions.createCamp({ name: 'Integration Camp', district: 'Badin', capacity: 10, current_families: 3, status: 'Active' });
ok(camp.status === 'Active', 'a new camp is created');
await actions.deleteCamp(camp.id);
ok((await api.loadAll()).camps.length === 8, 'and deleted again');

// Restore everything this script changed
await api.patch('inventory', 5, { stock: 800 });
await api.patch('needs', 12, { fulfilled_quantity: 150 });
await api.patch('inventory', 12, { stock: stockBefore });
await api.patch('camps', 1, { current_families: 320, status: 'Active' });
await api.patch('volunteers', 12, { camp_id: null });
await api.remove('donations', donation.id);
for (const d of (await api.list('dispatches')).filter((x) => x.id > 10)) await api.remove('dispatches', d.id);

const after = checkSeed(await api.loadAll());
ok(after.length === 0, 'the data was restored and still passes the seed check');
console.log(`\nIntegration run passed (${passed} checks).`);
