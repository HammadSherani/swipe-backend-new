// Generic placeholder restricted-category list for Step 4 (Business Info)
// screening — not sourced from any specific compliance document, meant to be
// replaced with the platform's real prohibited-MCC list.
export const RESTRICTED_MCC_CATEGORIES = [
  'GAMBLING',
  'WEAPONS_AMMUNITION',
  'ADULT_CONTENT',
  'UNLICENSED_MONEY_SERVICES',
  'CRYPTOCURRENCY_UNLICENSED',
  'PYRAMID_MLM_SCHEMES',
];

// MCC categories treated as DNFBP (Designated Non-Financial Businesses and
// Professions) for Step 6 — these require an SCUML number in Nigeria.
export const DNFBP_MCC_CATEGORIES = [
  'REAL_ESTATE',
  'JEWELRY_PRECIOUS_METALS',
  'LEGAL_SERVICES',
  'ACCOUNTING_SERVICES',
  'CASINO_GAMING',
];

export function isRestrictedMcc(category: string): boolean {
  return RESTRICTED_MCC_CATEGORIES.includes(category.toUpperCase());
}

export function requiresScuml(category: string): boolean {
  return DNFBP_MCC_CATEGORIES.includes(category.toUpperCase());
}

// Ordinary, everyday-language business categories a merchant can pick —
// nobody knows their numeric MCC code off-hand, so the app only ever asks
// for a category (this dropdown), never the raw code.
const COMMON_MCC_CATEGORIES = [
  'RETAIL',
  'GROCERY_STORES',
  'RESTAURANTS',
  'FASHION_APPAREL',
  'ELECTRONICS',
  'PHARMACY_HEALTH',
  'BEAUTY_SALON',
  'AUTOMOTIVE',
  'EDUCATION_SERVICES',
  'TRANSPORTATION_LOGISTICS',
  'HOTELS_HOSPITALITY',
  'AGRICULTURE',
  'CONSTRUCTION',
  'MANUFACTURING',
  'ENTERTAINMENT_MEDIA',
  'TELECOMMUNICATIONS',
  'PROFESSIONAL_SERVICES',
  'OTHER',
];

// Full dropdown: ordinary categories + the restricted/DNFBP ones above, so
// the same list stays the single source of truth for what's selectable and
// what those selections trigger downstream (block / SCUML requirement).
export const ALL_MCC_CATEGORIES = [
  ...COMMON_MCC_CATEGORIES,
  ...RESTRICTED_MCC_CATEGORIES,
  ...DNFBP_MCC_CATEGORIES,
] as [string, ...string[]];
