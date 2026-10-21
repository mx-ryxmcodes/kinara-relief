// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';
import { AppProvider } from '../src/context/AppContext.jsx';
import { createApi } from '../src/api/client.js';
import { ACCOUNTS, createFakeServer } from './helpers/fakeServer.js';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderApp(path = '/', server = createFakeServer(), account = 'coordinator') {
  if (account) window.localStorage.setItem('flood-relief-session', JSON.stringify({ token: `token-${account}`, user: ACCOUNTS[account].user }));
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider api={server.api}>
        <App />
      </AppProvider>
    </MemoryRouter>,
  );
  return { server, user: userEvent.setup() };
}

const bodyRows = (container) => within(container).getAllByRole('row').slice(1);

describe('dashboard', () => {
  it('shows the five KPIs and the critical gaps worst first', async () => {
    renderApp('/');
    await screen.findByRole('heading', { name: 'Critical gaps' });
    const value = (label) => screen.getByText(label).previousElementSibling.textContent;
    expect(value('Active camps')).toBe('7');
    expect(value('Families sheltered')).toBe('1,885');
    expect(value('Needs fulfilled overall')).toBe('50%');
    expect(value('Items at low stock')).toBe('3');
    expect(value('Volunteers deployed')).toBe('11');

    const section = screen.getByRole('heading', { name: 'Critical gaps' }).closest('section');
    const rows = bodyRows(section);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Larkana Stadium Camp');
    expect(rows[0]).toHaveTextContent('Cooking oil');
    expect(rows[0]).toHaveTextContent('0%');
    expect(rows[1]).toHaveTextContent('Rice');
    // Each row links back to its camp, focused on the need.
    expect(within(rows[0]).getByRole('link', { name: 'Open Larkana Stadium Camp' })).toHaveAttribute('href', '/camps/3?need=9');
  });

  it('lists the three most underserved camps and draws the chart summary', async () => {
    renderApp('/');
    const section = (await screen.findByRole('heading', { name: 'Underserved camps' })).closest('section');
    const names = within(section).getAllByRole('link').map((a) => a.textContent);
    expect(names).toEqual(['Larkana Stadium Camp', 'Johi Relief Camp', 'Rohri Highway Camp']);
    expect(screen.getByRole('img', { name: /Food 42%.*Hygiene 30%/ })).toBeInTheDocument();
  });

  it('shows a clear message when the API cannot be reached', async () => {
    const api = createApi('http://nowhere.test', async () => { throw new TypeError('fetch failed'); });
    window.localStorage.setItem('flood-relief-session', JSON.stringify({ token: 'token-coordinator', user: ACCOUNTS.coordinator.user }));
    render(
      <MemoryRouter>
        <AppProvider api={api}><App /></AppProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Cannot connect to the server/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('camps', () => {
  it('searches by name or district and filters by status together', async () => {
    const { user } = renderApp('/camps');
    await screen.findByRole('heading', { name: 'Camps' });
    expect(screen.getAllByRole('row')).toHaveLength(9);

    await user.type(screen.getByLabelText('Search camps by name or district'), 'dadu');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Johi Relief Camp')).toBeTruthy();
    expect(screen.getByText('Mehar School Camp')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'Full');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByText('Johi Relief Camp')).toBeNull();
  });

  it('adds a camp and marks it Full when families equal capacity', async () => {
    const { user, server } = renderApp('/camps');
    await user.click(await screen.findByRole('button', { name: 'Add camp' }));
    const dialog = screen.getByRole('dialog');

    // Empty submit shows field errors and saves nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Save camp' }));
    expect(within(dialog).getByText(/Enter the camp name/)).toBeTruthy();
    expect(server.db.camps).toHaveLength(8);

    await user.type(within(dialog).getByLabelText('Camp name'), 'Test Camp');
    await user.type(within(dialog).getByLabelText('District'), 'Badin');
    await user.type(within(dialog).getByLabelText('Capacity (families)'), '30');
    await user.type(within(dialog).getByLabelText('Families now'), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save camp' }));

    await waitFor(() => expect(server.db.camps).toHaveLength(9));
    expect(server.db.camps.at(-1)).toMatchObject({ name: 'Test Camp', status: 'Full' });
    expect(await screen.findByText('Test Camp added.')).toBeTruthy();
  });

  it('closing a camp from the list unassigns its volunteers after confirmation', async () => {
    const { user, server } = renderApp('/camps');
    const row = (await screen.findByText('Larkana Stadium Camp')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Close' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('3 volunteers will be unassigned');
    await user.click(within(dialog).getByRole('button', { name: 'Close camp' }));
    await waitFor(() => expect(server.db.camps.find((c) => c.id === 3).status).toBe('Closed'));
    expect(server.db.volunteers.filter((v) => v.camp_id === 3)).toHaveLength(0);
  });

  it('hides coordinator controls for a Field Volunteer and offers a families update', async () => {
    const { user } = renderApp('/camps');
    await screen.findByRole('heading', { name: 'Camps' });
    expect(screen.getByRole('button', { name: 'Add camp' })).toBeTruthy();
    cleanup();
    renderApp('/camps', createFakeServer(), 'volunteer');
    await screen.findByRole('heading', { name: 'Camps' });
    expect(screen.queryByRole('button', { name: 'Add camp' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Delete' })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Update families' })).toHaveLength(8);
  });
});

describe('camp detail and needs', () => {
  it('shows need progress and highlights the need from a dashboard link', async () => {
    renderApp('/camps/3?need=9');
    await screen.findByRole('heading', { name: 'Larkana Stadium Camp' });
    const row = document.getElementById('need-9');
    expect(row).toHaveClass('row-focus');
    expect(row).toHaveTextContent('Cooking oil');
    expect(within(row).getByRole('img', { name: '0% fulfilled' })).toBeTruthy();
    expect(within(document.getElementById('need-6')).getByRole('img', { name: '20% fulfilled' })).toBeTruthy();
  });

  it('adds a need to a camp', async () => {
    const { user, server } = renderApp('/camps/4');
    await user.click(await screen.findByRole('button', { name: 'Add need' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Inventory item'), 'Drinking water bottles (bottles)');
    await user.type(within(dialog).getByLabelText('Quantity required'), '800');
    await user.click(within(dialog).getByRole('button', { name: 'Save need' }));
    await waitFor(() => expect(server.db.needs).toHaveLength(21));
    expect(server.db.needs.at(-1)).toMatchObject({ camp_id: 4, inventory_item_id: 4, required_quantity: 800, priority: 'High', fulfilled_quantity: 0 });
  });

  it('reports a missing camp', async () => {
    renderApp('/camps/999');
    expect(await screen.findByText('Camp not found')).toBeTruthy();
  });
});

describe('inventory', () => {
  it('flags Low Stock items and can filter to them', async () => {
    const { user } = renderApp('/inventory');
    await screen.findByRole('heading', { name: 'Inventory' });
    expect(screen.getAllByText('Low Stock')).toHaveLength(3);
    await user.click(screen.getByLabelText('Low Stock only'));
    const table = screen.getByRole('table', { name: 'Warehouse inventory' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('Cooking oil')).toBeTruthy();
    expect(within(table).getByText('Water purification tablets')).toBeTruthy();
    expect(within(table).getByText('First aid kits')).toBeTruthy();
  });

  it('explains why an item in use cannot be deleted', async () => {
    const { user, server } = renderApp('/inventory');
    const table = await screen.findByRole('table', { name: 'Warehouse inventory' });
    const row = within(table).getByText('Wheat flour').closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete item' }));
    expect(await screen.findByText(/used by camp needs/)).toBeTruthy();
    expect(server.db.inventory).toHaveLength(12);
  });
});

describe('dispatches', () => {
  it('prefills from a link, shows the limits, and refuses a quantity over the need', async () => {
    const { user, server } = renderApp('/dispatches?camp=5&need=12');
    const form = await screen.findByRole('form', { name: 'Create dispatch' });
    expect(within(form).getByLabelText('Camp')).toHaveValue('5');
    expect(within(form).getByLabelText('Need')).toHaveValue('12');
    await waitFor(() => expect(form).toHaveTextContent('most you can send now'));
    expect(within(form).getByText('most you can send now').previousElementSibling).toHaveTextContent('50');

    await user.type(within(form).getByLabelText(/Quantity/), '60');
    await user.click(within(form).getByRole('button', { name: 'Create dispatch' }));
    expect(await within(form).findByText(/only 50 strips left unreserved/i)).toBeTruthy();
    expect(server.db.dispatches).toHaveLength(10);

    await user.clear(within(form).getByLabelText(/Quantity/));
    await user.type(within(form).getByLabelText(/Quantity/), '50');
    await user.click(within(form).getByRole('button', { name: 'Create dispatch' }));
    await waitFor(() => expect(server.db.dispatches).toHaveLength(11));
    expect(server.db.dispatches.at(-1)).toMatchObject({ camp_id: 5, need_id: 12, quantity: 50, status: 'Pending' });
    expect(server.db.inventory.find((i) => i.id === 5).stock).toBe(800);
  });

  it('filters by status and runs a dispatch through In Transit to Delivered', async () => {
    const { user, server } = renderApp('/dispatches');
    await screen.findByRole('heading', { name: 'All dispatches' });
    await user.click(screen.getByRole('button', { name: /^Pending/ }));
    expect(bodyRows(screen.getByRole('heading', { name: 'All dispatches' }).closest('section'))).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Mark In Transit' })[0]); // dispatch 8
    await waitFor(() => expect(server.db.dispatches.find((d) => d.id === 8).status).toBe('In Transit'));

    await user.click(screen.getByRole('button', { name: /^In Transit/ }));
    const row = (await screen.findAllByRole('row')).find((r) => r.textContent.startsWith('8'));
    await user.click(within(row).getByRole('button', { name: 'Mark Delivered' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark Delivered' }));
    await waitFor(() => expect(server.db.dispatches.find((d) => d.id === 8).status).toBe('Delivered'));
    expect(server.db.inventory.find((i) => i.id === 5).stock).toBe(500);
    expect(server.db.needs.find((n) => n.id === 12).fulfilled_quantity).toBe(450);
  });

  it('lets a Field Volunteer mark Delivered but not create or cancel', async () => {
    renderApp('/dispatches', createFakeServer(), 'volunteer');
    await screen.findByRole('heading', { name: 'All dispatches' });
    expect(screen.queryByRole('form', { name: 'Create dispatch' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Cancel' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Mark In Transit' })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Mark Delivered' }).length).toBeGreaterThan(0);
  });
});

describe('donations', () => {
  it('shows cash totals and per-category totals', async () => {
    renderApp('/donations');
    await screen.findByRole('heading', { name: 'Donations' });
    expect(screen.getByText('PKR 1,300,000')).toBeTruthy();
    const totals = screen.getByRole('table', { name: 'Donations by category' });
    const food = within(totals).getByRole('cell', { name: 'Food' }).closest('tr');
    expect(food).toHaveTextContent('PKR 500,000');
  });

  it('records an In-Kind donation and raises stock', async () => {
    const { user, server } = renderApp('/donations');
    const form = await screen.findByRole('form', { name: 'Record donation' });
    await user.click(within(form).getByLabelText('In-Kind'));
    await user.selectOptions(within(form).getByLabelText('Item donated'), 'Hygiene kits (kits)');
    await user.type(within(form).getByLabelText(/^Quantity/), '25');
    await user.click(within(form).getByRole('button', { name: 'Record donation' }));
    await waitFor(() => expect(server.db.donations).toHaveLength(11));
    expect(server.db.inventory.find((i) => i.id === 12).stock).toBe(475);
  });
});

describe('volunteers', () => {
  it('filters by skill', async () => {
    const { user } = renderApp('/volunteers');
    await screen.findByRole('heading', { name: 'Volunteers' });
    await user.selectOptions(screen.getByLabelText('Filter by skill'), 'Medical');
    const rows = bodyRows(screen.getByRole('table'));
    expect(rows.map((r) => r.querySelector('td').textContent).sort()).toEqual(['Ayesha Khoso', 'Hina Mangi', 'Sadia Lashari']);
  });

  it('never offers a Closed camp and assigns a volunteer', async () => {
    const { user, server } = renderApp('/volunteers');
    const row = (await screen.findByText('Asif Leghari')).closest('tr');
    const select = within(row).getByLabelText('Camp for Asif Leghari');
    expect(within(select).queryByRole('option', { name: 'Thatta Bypass Camp' })).toBeNull();
    await user.selectOptions(select, 'Ratodero Camp');
    await waitFor(() => expect(server.db.volunteers.find((v) => v.id === 12).camp_id).toBe(4));
  });

  it('asks before moving an assigned volunteer', async () => {
    const { user, server } = renderApp('/volunteers');
    const row = (await screen.findByText('Ayesha Khoso')).closest('tr');
    await user.selectOptions(within(row).getByLabelText('Camp for Ayesha Khoso'), 'Ratodero Camp');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Johi Relief Camp');
    expect(server.db.volunteers.find((v) => v.id === 1).camp_id).toBe(1);
    await user.click(within(dialog).getByRole('button', { name: 'Move volunteer' }));
    await waitFor(() => expect(server.db.volunteers.find((v) => v.id === 1).camp_id).toBe(4));
  });
});

describe('sign in', () => {
  it('asks for an ID and password, refuses wrong ones, and signs in and out', async () => {
    const { user } = renderApp('/', createFakeServer(), null);
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your ID and password.')).toBeTruthy();

    await user.type(screen.getByLabelText('ID'), 'volunteer');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect ID or password.')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();

    await user.type(screen.getByLabelText('Password'), 'vol-pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.getByText('Field Volunteer')).toBeTruthy();
    expect(window.localStorage.getItem('flood-relief-session')).toContain('token-volunteer');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(window.localStorage.getItem('flood-relief-session')).toBeNull();
  });

  it('shows no data before sign-in and keeps a Field Volunteer away from admin controls', async () => {
    const { user, server } = renderApp('/camps', createFakeServer(), null);
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(server.calls.filter((c) => c.startsWith('GET /camps'))).toHaveLength(0);
    await user.type(screen.getByLabelText('ID'), 'volunteer');
    await user.type(screen.getByLabelText('Password'), 'vol-pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Camps' });
    expect(screen.queryByRole('button', { name: 'Add camp' })).toBeNull();
  });

  it('stays signed in after a reload', async () => {
    renderApp('/', createFakeServer(), 'volunteer');
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.getByText('Field Volunteer')).toBeTruthy();
  });
});
