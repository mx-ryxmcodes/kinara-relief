// Shared vocabulary for the whole app. Keep every enum here so the UI,
// validators and rules cannot drift apart.

export const CAMP_STATUSES = ['Active', 'Full', 'Closed'];
export const PRIORITIES = ['High', 'Medium', 'Low'];
export const DISPATCH_STATUSES = ['Pending', 'In Transit', 'Delivered', 'Cancelled'];
export const ACTIVE_DISPATCH_STATUSES = ['Pending', 'In Transit'];
export const SKILLS = ['Medical', 'Logistics', 'Cooking', 'Driving', 'Counselling'];
export const CATEGORIES = ['Food', 'Water', 'Medical', 'Shelter', 'Hygiene'];
export const DONATION_TYPES = ['Cash', 'In-Kind'];

// A High-priority need is a critical gap when it is below this fulfilment.
export const CRITICAL_THRESHOLD = 0.4;

// Weights for the per-camp "underserved" score.
export const PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };
export const UNDERSERVED_COUNT = 3;

export const COLLECTIONS = ['camps', 'inventory', 'needs', 'dispatches', 'donations', 'volunteers'];

// Suggestions only. The district field accepts any text.
export const SINDH_DISTRICTS = [
  'Badin', 'Dadu', 'Ghotki', 'Hyderabad', 'Jacobabad', 'Jamshoro', 'Kashmore',
  'Khairpur', 'Larkana', 'Matiari', 'Mirpur Khas', 'Naushahro Feroze',
  'Qambar Shahdadkot', 'Sanghar', 'Shaheed Benazirabad', 'Shikarpur', 'Sujawal',
  'Sukkur', 'Tando Allahyar', 'Tando Muhammad Khan', 'Tharparkar', 'Thatta', 'Umerkot',
  'Karachi Central', 'Karachi East', 'Karachi South', 'Karachi West', 'Korangi', 'Malir', 'Keamari',
];
