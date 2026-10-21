// Role permissions (PRD, "Users and roles"). These only hide or disable
// controls in the UI. The app has no login and JSON Server has no auth, so
// this is not a security boundary.
export const COORDINATOR = 'Relief Coordinator';
export const FIELD_VOLUNTEER = 'Field Volunteer';
export const ROLES = [COORDINATOR, FIELD_VOLUNTEER];

export const ROLE_TITLE = {
  [COORDINATOR]: 'Relief Coordinator (Admin)',
  [FIELD_VOLUNTEER]: 'Field Volunteer',
};
export const roleTitle = (role) => ROLE_TITLE[role] || role;

export const initials = (name) =>
  name
    .replace(/^(dr|mr|ms|mrs)\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

const BOTH = [COORDINATOR, FIELD_VOLUNTEER];
const ADMIN_ONLY = [COORDINATOR];

const MATRIX = {
  'camp.write': ADMIN_ONLY,
  'camp.families': BOTH,
  'need.write': ADMIN_ONLY,
  'inventory.write': ADMIN_ONLY,
  'dispatch.create': ADMIN_ONLY,
  'dispatch.transit': ADMIN_ONLY,
  'dispatch.cancel': ADMIN_ONLY,
  'dispatch.deliver': BOTH,
  'donation.write': ADMIN_ONLY,
  'volunteer.write': ADMIN_ONLY,
  'volunteer.assign': ADMIN_ONLY,
  // Direct writes to the data routes skip the app's checks, so only the admin gets them.
  'api.write': ADMIN_ONLY,
};

// Which capability each server action needs. The server refuses any action that is
// not listed here, so a new action stays locked until it is given a capability.
export const ACTION_CAPABILITY = {
  createCamp: 'camp.write',
  updateCamp: 'camp.write',
  setCampClosed: 'camp.write',
  deleteCamp: 'camp.write',
  updateCampFamilies: 'camp.families',
  createItem: 'inventory.write',
  updateItem: 'inventory.write',
  deleteItem: 'inventory.write',
  createNeed: 'need.write',
  updateNeed: 'need.write',
  deleteNeed: 'need.write',
  createDispatch: 'dispatch.create',
  markInTransit: 'dispatch.transit',
  markDelivered: 'dispatch.deliver',
  cancelDispatch: 'dispatch.cancel',
  createDonation: 'donation.write',
  createVolunteer: 'volunteer.write',
  updateVolunteer: 'volunteer.write',
  deleteVolunteer: 'volunteer.write',
  assignVolunteer: 'volunteer.assign',
  unassignVolunteer: 'volunteer.assign',
};

export const can = (role, capability) => (MATRIX[capability] || []).includes(role);
