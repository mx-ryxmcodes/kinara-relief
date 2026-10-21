// Input validation. Each validator returns { ok, errors, value }.
// `errors` maps a field name to a message; `value` is the cleaned record.
import { CATEGORIES, PRIORITIES, SKILLS } from './constants.js';
import { resolveCampStatus } from './rules.js';

const clean = (s) => (typeof s === 'string' ? s.trim() : '');

// Whole number from a form value; NaN when blank or not a whole number.
export function toInt(value) {
  if (value === '' || value === null || value === undefined) return NaN;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

const finish = (errors, value) => ({ ok: Object.keys(errors).length === 0, errors, value });

export function validateCamp(input) {
  const errors = {};
  const name = clean(input.name);
  const district = clean(input.district);
  const capacity = toInt(input.capacity);
  const families = toInt(input.current_families);
  if (name.length < 2) errors.name = 'Enter the camp name (at least 2 characters).';
  else if (name.length > 80) errors.name = 'Keep the name under 80 characters.';
  if (!district) errors.district = 'Enter the district.';
  if (Number.isNaN(capacity) || capacity < 1) errors.capacity = 'Capacity must be a whole number of at least 1.';
  if (Number.isNaN(families) || families < 0) errors.current_families = 'Families must be a whole number, 0 or more.';
  const requested = input.status === 'Closed' ? 'Closed' : 'Active';
  const value = { name, district, capacity, current_families: families, status: requested };
  if (Object.keys(errors).length === 0) value.status = resolveCampStatus(value);
  return finish(errors, value);
}

export function validateItem(input) {
  const errors = {};
  const name = clean(input.name);
  const unit = clean(input.unit);
  const stock = toInt(input.stock);
  const reorder = toInt(input.reorder_level);
  if (!name) errors.name = 'Enter the item name.';
  if (!CATEGORIES.includes(input.category)) errors.category = 'Choose a category.';
  if (!unit) errors.unit = 'Enter the unit, for example kg or kits.';
  if (Number.isNaN(stock) || stock < 0) errors.stock = 'Stock must be a whole number, 0 or more.';
  if (Number.isNaN(reorder) || reorder < 0) errors.reorder_level = 'Reorder level must be a whole number, 0 or more.';
  return finish(errors, { name, category: input.category, unit, stock, reorder_level: reorder });
}

export function validateNeed(input) {
  const errors = {};
  const itemId = toInt(input.inventory_item_id);
  const required = toInt(input.required_quantity);
  if (Number.isNaN(itemId)) errors.inventory_item_id = 'Choose an inventory item.';
  if (Number.isNaN(required) || required < 1) errors.required_quantity = 'Required quantity must be a whole number of at least 1.';
  if (!PRIORITIES.includes(input.priority)) errors.priority = 'Choose High, Medium or Low.';
  return finish(errors, { inventory_item_id: itemId, required_quantity: required, priority: input.priority });
}

export function validateDispatchInput(input) {
  const errors = {};
  const campId = toInt(input.camp_id);
  const needId = toInt(input.need_id);
  const quantity = toInt(input.quantity);
  if (Number.isNaN(campId)) errors.camp_id = 'Choose a camp.';
  if (Number.isNaN(needId)) errors.need_id = 'Choose a need.';
  if (Number.isNaN(quantity) || quantity < 1) errors.quantity = 'Quantity must be a whole number of at least 1.';
  return finish(errors, { camp_id: campId, need_id: needId, quantity });
}

export function validateDonation(input) {
  const errors = {};
  const donor = clean(input.donor_name);
  const amount = toInt(input.amount_or_quantity);
  if (donor.length > 80) errors.donor_name = 'Keep the donor name under 80 characters.';
  if (input.type !== 'Cash' && input.type !== 'In-Kind') errors.type = 'Choose Cash or In-Kind.';
  const value = { type: input.type, donor_name: donor, amount_or_quantity: amount, item_id: null, category: input.category };
  if (input.type === 'Cash') {
    if (Number.isNaN(amount) || amount < 1) errors.amount_or_quantity = 'Amount must be a whole number of rupees, at least 1.';
    if (!CATEGORIES.includes(input.category)) errors.category = 'Choose the category this cash is for.';
  } else if (input.type === 'In-Kind') {
    const itemId = toInt(input.item_id);
    if (Number.isNaN(itemId)) errors.item_id = 'Choose the item donated.';
    if (Number.isNaN(amount) || amount < 1) errors.amount_or_quantity = 'Quantity must be a whole number of at least 1.';
    value.item_id = Number.isNaN(itemId) ? null : itemId;
  }
  return finish(errors, value);
}

export function validateVolunteer(input) {
  const errors = {};
  const name = clean(input.name);
  if (name.length < 2) errors.name = 'Enter the volunteer name.';
  else if (name.length > 80) errors.name = 'Keep the name under 80 characters.';
  if (!SKILLS.includes(input.skill)) errors.skill = 'Choose a skill.';
  return finish(errors, { name, skill: input.skill });
}
