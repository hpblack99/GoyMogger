export interface FreshXOption { key: string; label: string }

export const FRESHX_TEMPERATURES: FreshXOption[] = [
  { key: 'AMBIENT', label: 'Ambient (45°F – 70°F)' },
  { key: 'CHILLED', label: 'Chilled (32°F – 40°F)' },
  { key: 'FROZEN',  label: 'Frozen (-10°F – 10°F)' },
]

export const FRESHX_COMMODITIES: FreshXOption[] = [
  { key: 'ALCOHOL',        label: 'Alcohol'        },
  { key: 'FOODSTUFFS',     label: 'Foodstuffs'     },
  { key: 'FRESH_SEAFOOD',  label: 'Fresh Seafood'  },
  { key: 'FROZEN_SEAFOOD', label: 'Frozen Seafood' },
  { key: 'ICE_CREAM',      label: 'Ice Cream'      },
  { key: 'OTHER',          label: 'Other'          },
  { key: 'PRODUCE',        label: 'Produce'        },
]
