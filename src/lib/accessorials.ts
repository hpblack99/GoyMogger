export interface Accessorial { key: string; label: string; note?: string }

export const ACCESSORIALS: Accessorial[] = [
  { key: 'inside_pickup_delivery',    label: 'Inside Pickup / Delivery Charge',     note: 'Pending Availability' },
  { key: 'ltl_night_pickup_delivery', label: 'LTL Night Pickup or Delivery Charge'                               },
  { key: 'locations_without_dock',    label: 'Locations without Dock Facilities'                                 },
  { key: 'convention_center',         label: 'Convention Center'                                                 },
  { key: 'restricted_security',       label: 'Restricted Security Locations'                                     },
  { key: 'guaranteed_service',        label: 'Guaranteed Service'                                                },
  { key: 'liftgate_fee',              label: 'Liftgate Fee',                          note: 'Pending Availability' },
  { key: 'multi_temperature',         label: 'Multi-temperature Services'                                        },
  { key: 'limited_access',            label: 'Limited Access'                                                    },
]

export const ACCESSORIAL_MAP = Object.fromEntries(ACCESSORIALS.map((a) => [a.key, a]))
