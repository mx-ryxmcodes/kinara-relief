// Seed dataset for the mock API. All names, quantities and amounts are
// fictional demo data. Counts follow the brief: 8 camps (6 districts, one Full,
// one Closed), 12 inventory items (3 Low Stock), 20 needs (5 Critical Gaps),
// 10 dispatches, 10 donations, 15 volunteers.

export function buildSeed() {
  const camps = [
    { id: 1, name: 'Johi Relief Camp', district: 'Dadu', capacity: 400, current_families: 320, status: 'Active' },
    { id: 2, name: 'Mehar School Camp', district: 'Dadu', capacity: 250, current_families: 250, status: 'Full' },
    { id: 3, name: 'Larkana Stadium Camp', district: 'Larkana', capacity: 500, current_families: 410, status: 'Active' },
    { id: 4, name: 'Ratodero Camp', district: 'Larkana', capacity: 300, current_families: 180, status: 'Active' },
    { id: 5, name: 'Rohri Highway Camp', district: 'Sukkur', capacity: 350, current_families: 275, status: 'Active' },
    { id: 6, name: 'Thul Relief Camp', district: 'Jacobabad', capacity: 280, current_families: 240, status: 'Active' },
    { id: 7, name: 'Sehwan Camp', district: 'Jamshoro', capacity: 320, current_families: 210, status: 'Active' },
    { id: 8, name: 'Thatta Bypass Camp', district: 'Thatta', capacity: 200, current_families: 0, status: 'Closed' },
  ];

  const inventory = [
    { id: 1, name: 'Wheat flour', category: 'Food', unit: 'kg', stock: 4000, reorder_level: 1500 },
    { id: 2, name: 'Cooking oil', category: 'Food', unit: 'litres', stock: 300, reorder_level: 400 },
    { id: 3, name: 'Rice', category: 'Food', unit: 'kg', stock: 2500, reorder_level: 1000 },
    { id: 4, name: 'Drinking water bottles', category: 'Water', unit: 'bottles', stock: 12000, reorder_level: 5000 },
    { id: 5, name: 'Water purification tablets', category: 'Water', unit: 'strips', stock: 800, reorder_level: 800 },
    { id: 6, name: 'ORS sachets', category: 'Medical', unit: 'sachets', stock: 3000, reorder_level: 1000 },
    { id: 7, name: 'Paracetamol', category: 'Medical', unit: 'packs', stock: 600, reorder_level: 500 },
    { id: 8, name: 'First aid kits', category: 'Medical', unit: 'kits', stock: 90, reorder_level: 100 },
    { id: 9, name: 'Tents', category: 'Shelter', unit: 'units', stock: 220, reorder_level: 100 },
    { id: 10, name: 'Tarpaulin sheets', category: 'Shelter', unit: 'sheets', stock: 700, reorder_level: 300 },
    { id: 11, name: 'Mosquito nets', category: 'Shelter', unit: 'nets', stock: 1500, reorder_level: 400 },
    { id: 12, name: 'Hygiene kits', category: 'Hygiene', unit: 'kits', stock: 450, reorder_level: 200 },
  ];

  // fulfilled_quantity may exceed the sum of Delivered dispatches: it also
  // counts supplies delivered before this system was in use (opening balance).
  const n = (id, camp_id, inventory_item_id, required_quantity, priority, fulfilled_quantity) => ({
    id, camp_id, inventory_item_id, required_quantity, priority, fulfilled_quantity,
  });
  const needs = [
    n(1, 1, 1, 2000, 'High', 1500),
    n(2, 1, 4, 4000, 'High', 1000),
    n(3, 1, 9, 60, 'Medium', 20),
    n(4, 2, 12, 250, 'High', 100),
    n(5, 2, 6, 500, 'Medium', 500),
    n(6, 3, 3, 3000, 'High', 600),
    n(7, 3, 8, 40, 'High', 30),
    n(8, 3, 11, 400, 'Medium', 100),
    n(9, 3, 2, 200, 'High', 0),
    n(10, 4, 1, 1200, 'High', 900),
    n(11, 4, 10, 150, 'Low', 150),
    n(12, 5, 5, 500, 'High', 150),
    n(13, 5, 7, 200, 'Medium', 100),
    n(14, 5, 9, 80, 'High', 50),
    n(15, 6, 4, 3000, 'High', 2100),
    n(16, 6, 12, 200, 'Medium', 40),
    n(17, 6, 3, 1500, 'Low', 600),
    n(18, 7, 6, 600, 'High', 450),
    n(19, 7, 11, 300, 'High', 100),
    n(20, 8, 9, 40, 'Low', 40),
  ];

  const d = (id, camp_id, need_id, quantity, status) => ({ id, camp_id, need_id, quantity, status });
  const dispatches = [
    d(1, 1, 1, 500, 'Delivered'),
    d(2, 3, 6, 300, 'Delivered'),
    d(3, 5, 14, 30, 'Delivered'),
    d(4, 6, 15, 1000, 'Delivered'),
    d(5, 2, 4, 50, 'Delivered'),
    d(6, 1, 2, 800, 'In Transit'),
    d(7, 6, 15, 400, 'Pending'),
    d(8, 5, 12, 300, 'Pending'),
    d(9, 7, 19, 100, 'In Transit'),
    d(10, 3, 7, 10, 'Cancelled'),
  ];

  const cash = (id, amount, category, donor_name, date) => ({
    id, type: 'Cash', donor_name, amount_or_quantity: amount, item_id: null, category, date,
  });
  const inKind = (id, quantity, item_id, category, donor_name, date) => ({
    id, type: 'In-Kind', donor_name, amount_or_quantity: quantity, item_id, category, date,
  });
  const donations = [
    cash(1, 500000, 'Food', 'Local traders group', '2026-09-10'),
    cash(2, 250000, 'Water', 'Anonymous donor', '2026-09-12'),
    inKind(3, 1000, 1, 'Food', 'Community welfare group', '2026-09-14'),
    inKind(4, 3000, 4, 'Water', 'Bottling plant staff', '2026-09-16'),
    cash(5, 150000, 'Medical', 'University alumni association', '2026-09-20'),
    inKind(6, 200, 7, 'Medical', 'Pharmacists association', '2026-09-24'),
    inKind(7, 60, 9, 'Shelter', 'Textile mill workers', '2026-09-28'),
    cash(8, 300000, 'Shelter', 'Anonymous donor', '2026-10-02'),
    inKind(9, 150, 12, 'Hygiene', 'Women welfare society', '2026-10-08'),
    cash(10, 100000, 'Hygiene', 'Teachers union fund', '2026-10-15'),
  ];

  const v = (id, name, skill, camp_id) => ({ id, name, skill, camp_id });
  const volunteers = [
    v(1, 'Ayesha Khoso', 'Medical', 1),
    v(2, 'Imran Shaikh', 'Driving', 1),
    v(3, 'Farah Soomro', 'Counselling', 2),
    v(4, 'Zain Chandio', 'Logistics', 3),
    v(5, 'Noor Jatoi', 'Cooking', 3),
    v(6, 'Hamza Mirani', 'Driving', 3),
    v(7, 'Sadia Lashari', 'Medical', 5),
    v(8, 'Bilal Rind', 'Logistics', 5),
    v(9, 'Mehwish Abro', 'Cooking', 6),
    v(10, 'Kashif Sangi', 'Logistics', 7),
    v(11, 'Rubina Panhwar', 'Counselling', 7),
    v(12, 'Asif Leghari', 'Driving', null),
    v(13, 'Hina Mangi', 'Medical', null),
    v(14, 'Tariq Halepoto', 'Logistics', null),
    v(15, 'Saima Dahri', 'Cooking', null),
  ];

  return { camps, inventory, needs, dispatches, donations, volunteers };
}
