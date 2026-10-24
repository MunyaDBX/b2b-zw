import { z } from 'zod';
import type { ListingType } from '@/types/models';

/**
 * Single source of truth per vertical: drives the create form, its Zod schema,
 * and the read-only detail view. Field names match the detail table columns, and
 * min/max mirror the CHECK constraints in the migrations (the DB stays authoritative).
 */

type Option = { value: string; label: string };

export type Field =
  | { kind: 'text'; name: string; label: string; placeholder?: string; optional?: boolean }
  | { kind: 'number'; name: string; label: string; min?: number; max?: number; integer?: boolean; optional?: boolean; suffix?: string }
  | { kind: 'date'; name: string; label: string; optional?: boolean }
  | { kind: 'boolean'; name: string; label: string; default?: boolean }
  | { kind: 'select'; name: string; label: string; options: Option[]; default?: string }
  | { kind: 'multi'; name: string; label: string; options: Option[] };

export type BiddingMode = 'sealed' | 'auction' | 'none';

export interface Vertical {
  type: ListingType;
  label: string;
  blurb: string;
  /** Who posts: a buyer requesting quotes, or a provider offering capacity. */
  postedBy: 'buyer' | 'provider';
  bidding: BiddingMode;
  biddingRequired: boolean;
  priceLabel: string;
  bidLabel: string;
  fields: Field[];
}

const opts = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));

export const VERTICALS: Record<ListingType, Vertical> = {
  rfq_procurement: {
    type: 'rfq_procurement',
    label: 'Procurement RFQ',
    blurb: 'Sealed competitive quotes for goods and materials',
    postedBy: 'buyer',
    bidding: 'sealed',
    biddingRequired: true,
    priceLabel: 'Budget',
    bidLabel: 'Quote amount',
    fields: [],
  },
  asset_auction: {
    type: 'asset_auction',
    label: 'Surplus Auction',
    blurb: 'De-fleet machinery or clear obsolete inventory',
    postedBy: 'provider',
    bidding: 'auction',
    biddingRequired: true,
    priceLabel: 'Opening price',
    bidLabel: 'Bid',
    fields: [],
  },
  freight_haulage: {
    type: 'freight_haulage',
    label: 'Freight Job',
    blurb: '3t–30t haulage with digital BoL and ePoD',
    postedBy: 'buyer',
    bidding: 'sealed',
    biddingRequired: false,
    priceLabel: 'Target rate',
    bidLabel: 'Haulage rate',
    fields: [
      { kind: 'text', name: 'origin_address', label: 'Pickup', placeholder: 'Msasa, Harare' },
      { kind: 'text', name: 'destination_address', label: 'Drop-off', placeholder: 'Beira Port' },
      {
        kind: 'select', name: 'cargo_type', label: 'Cargo', default: 'palletized',
        options: opts(['palletized', 'Palletised'], ['bulk_grain', 'Bulk grain'], ['fuel_tanker', 'Fuel'],
          ['heavy_machinery', 'Machinery'], ['containerized', 'Container'], ['general', 'General']),
      },
      {
        kind: 'select', name: 'required_truck_type', label: 'Truck', default: '30ton_curtain_side',
        options: opts(['3ton_rigid', '3t rigid'], ['7ton_flatbed', '7t flatbed'], ['15ton_rigid', '15t rigid'],
          ['30ton_curtain_side', '30t tautliner'], ['30ton_flatbed', '30t flatbed'], ['refrigerated', 'Reefer'],
          ['tanker', 'Tanker'], ['lowbed', 'Lowbed']),
      },
      { kind: 'number', name: 'cargo_weight_tonnes', label: 'Weight', min: 0.1, max: 60, suffix: 't' },
      { kind: 'date', name: 'pickup_window_start', label: 'Pickup date', optional: true },
    ],
  },
  fuel_procurement: {
    type: 'fuel_procurement',
    label: 'Bulk Fuel',
    blurb: 'Depot pickup or on-site bowser drops (5,000–40,000 L)',
    postedBy: 'buyer',
    bidding: 'sealed',
    biddingRequired: true,
    priceLabel: 'Budget',
    bidLabel: 'Total price',
    fields: [
      {
        kind: 'select', name: 'fuel_type', label: 'Fuel', default: 'diesel_50ppm',
        options: opts(['diesel_50ppm', 'Diesel 50ppm'], ['petrol_unleaded', 'Unleaded'], ['heavy_fuel_oil', 'HFO'], ['lpg_gas', 'LPG']),
      },
      { kind: 'number', name: 'quantity_liters', label: 'Quantity', min: 500, max: 1_000_000, suffix: 'L' },
      {
        kind: 'select', name: 'delivery_type', label: 'Delivery', default: 'onsite_bowser_drop',
        options: opts(['onsite_bowser_drop', 'On-site bowser'], ['depot_pickup', 'Depot pickup']),
      },
      { kind: 'number', name: 'target_price_per_liter', label: 'Target price per litre', min: 0.0001 },
      { kind: 'boolean', name: 'requires_metered_discharge', label: 'Metered discharge required', default: true },
    ],
  },
  plant_machinery: {
    type: 'plant_machinery',
    label: 'Plant Hire',
    blurb: 'Excavators, dozers, cranes and generators',
    postedBy: 'provider',
    bidding: 'none',
    biddingRequired: false,
    priceLabel: 'Indicative price',
    bidLabel: 'Offer',
    fields: [
      {
        kind: 'select', name: 'equipment_type', label: 'Equipment', default: 'excavator',
        options: opts(['excavator', 'Excavator'], ['bulldozer', 'Bulldozer'], ['crane', 'Crane'],
          ['tipper_truck', 'Tipper'], ['generator', 'Generator'], ['grader', 'Grader'], ['tlb', 'TLB']),
      },
      { kind: 'text', name: 'make_model', label: 'Make & model', placeholder: 'CAT 320D' },
      { kind: 'number', name: 'year_of_manufacture', label: 'Year', integer: true, min: 1950, max: 2100, optional: true },
      { kind: 'text', name: 'capacity_rating', label: 'Capacity', placeholder: '20 t / 500 kVA' },
      {
        kind: 'select', name: 'rate_type', label: 'Rate basis', default: 'daily',
        options: opts(['hourly', 'Hourly'], ['daily', 'Daily'], ['monthly', 'Monthly'], ['wet_rate', 'Wet'], ['dry_rate', 'Dry']),
      },
      { kind: 'number', name: 'rate_amount', label: 'Rate', min: 0.01 },
      { kind: 'boolean', name: 'includes_operator', label: 'Operator included', default: true },
      { kind: 'number', name: 'mobilization_fee', label: 'Mobilisation fee', min: 0, optional: true },
      { kind: 'date', name: 'last_safety_inspection', label: 'Last safety inspection', optional: true },
    ],
  },
  storage_space: {
    type: 'storage_space',
    label: 'Warehouse & Storage',
    blurb: 'Bonded, cold, racked or open-yard space',
    postedBy: 'provider',
    bidding: 'none',
    biddingRequired: false,
    priceLabel: 'Indicative monthly',
    bidLabel: 'Offer',
    fields: [
      {
        kind: 'select', name: 'storage_type', label: 'Type', default: 'pallet_racking',
        options: opts(['bonded_warehouse', 'Bonded'], ['open_yard', 'Open yard'], ['cold_storage', 'Cold'],
          ['pallet_racking', 'Racking'], ['office', 'Office']),
      },
      { kind: 'number', name: 'total_area_sqm', label: 'Area', min: 1, optional: true, suffix: 'm²' },
      { kind: 'number', name: 'available_pallet_spaces', label: 'Pallet spaces', integer: true, min: 0, optional: true },
      { kind: 'number', name: 'dock_doors', label: 'Dock doors', integer: true, min: 0, optional: true },
      {
        kind: 'multi', name: 'security_features', label: 'Security',
        options: opts(['24_7_guard', '24/7 guard'], ['cctv', 'CCTV'], ['fenced', 'Fenced'], ['fire_suppression', 'Fire suppression']),
      },
      { kind: 'number', name: 'rate_per_sqm_or_pallet', label: 'Rate per m² / pallet', min: 0.01 },
      { kind: 'number', name: 'minimum_lease_days', label: 'Minimum lease', integer: true, min: 1, suffix: 'days' },
    ],
  },
  sla_service: {
    type: 'sla_service',
    label: 'SLA Contractor',
    blurb: 'Solar, HVAC, electrical and plumbing maintenance',
    postedBy: 'buyer',
    bidding: 'sealed',
    biddingRequired: false,
    priceLabel: 'Budget',
    bidLabel: 'Contract price',
    fields: [
      {
        kind: 'select', name: 'trade', label: 'Trade', default: 'electrical',
        options: opts(['solar', 'Solar'], ['hvac', 'HVAC'], ['electrical', 'Electrical'], ['plumbing', 'Plumbing'], ['civil', 'Civil']),
      },
      {
        kind: 'select', name: 'priority', label: 'Priority', default: 'p3_normal',
        options: opts(['p1_critical', 'P1'], ['p2_high', 'P2'], ['p3_normal', 'P3'], ['p4_low', 'P4']),
      },
      { kind: 'number', name: 'response_time_hours', label: 'Response time', integer: true, min: 1, suffix: 'h' },
      { kind: 'number', name: 'resolution_time_hours', label: 'Resolution time', integer: true, min: 1, suffix: 'h' },
      { kind: 'number', name: 'penalty_per_breach', label: 'Penalty per breach', min: 0, optional: true },
      { kind: 'number', name: 'contract_months', label: 'Contract length', integer: true, min: 1, optional: true, suffix: 'months' },
    ],
  },
  agri_offtake: {
    type: 'agri_offtake',
    label: 'Agri Off-take',
    blurb: 'Forward purchase contracts with farming unions',
    postedBy: 'buyer',
    bidding: 'sealed',
    biddingRequired: false,
    priceLabel: 'Contract value',
    bidLabel: 'Offer value',
    fields: [
      { kind: 'text', name: 'commodity', label: 'Commodity', placeholder: 'White maize' },
      { kind: 'text', name: 'grade', label: 'Grade', placeholder: 'Grade A', optional: true },
      { kind: 'number', name: 'quantity_tonnes', label: 'Quantity', min: 0.1, suffix: 't' },
      { kind: 'number', name: 'price_per_tonne', label: 'Price per tonne', min: 0.01 },
      { kind: 'text', name: 'harvest_season', label: 'Season', placeholder: '2026/27' },
      { kind: 'date', name: 'delivery_window_start', label: 'Delivery from', optional: true },
      { kind: 'date', name: 'delivery_window_end', label: 'Delivery to', optional: true },
      { kind: 'boolean', name: 'requires_cold_chain', label: 'Cold chain required', default: false },
    ],
  },
  commercial_property: {
    type: 'commercial_property',
    label: 'Commercial Property',
    blurb: 'Offices, industrial units and executive stays',
    postedBy: 'provider',
    bidding: 'none',
    biddingRequired: false,
    priceLabel: 'Indicative price',
    bidLabel: 'Offer',
    fields: [
      {
        kind: 'select', name: 'property_use', label: 'Use', default: 'office',
        options: opts(['office', 'Office'], ['industrial', 'Industrial'], ['retail', 'Retail'], ['executive_stay', 'Executive stay']),
      },
      { kind: 'number', name: 'area_sqm', label: 'Area', min: 1, optional: true, suffix: 'm²' },
      { kind: 'number', name: 'monthly_rent', label: 'Monthly rent', min: 0.01 },
      { kind: 'number', name: 'min_lease_months', label: 'Minimum lease', integer: true, min: 1, suffix: 'months' },
      { kind: 'boolean', name: 'furnished', label: 'Furnished', default: false },
    ],
  },
};

export const VERTICAL_LIST = Object.values(VERTICALS);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

function fieldSchema(f: Field): z.ZodTypeAny {
  switch (f.kind) {
    case 'text': {
      const s = z.string().trim().max(500);
      return f.optional ? z.preprocess(blankToUndefined, s.optional()) : s.min(1, `${f.label} is required`);
    }
    case 'number': {
      let n = z.coerce.number({ invalid_type_error: 'Enter a number' });
      if (f.integer) n = n.int('Whole numbers only');
      if (f.min !== undefined) n = n.min(f.min, `Minimum ${f.min}`);
      if (f.max !== undefined) n = n.max(f.max, `Maximum ${f.max}`);
      return f.optional ? z.preprocess(blankToUndefined, n.optional()) : z.preprocess(blankToUndefined, n);
    }
    case 'date': {
      const d = z.string().regex(ISO_DATE, 'Use YYYY-MM-DD');
      return f.optional ? z.preprocess(blankToUndefined, d.optional()) : d;
    }
    case 'boolean':
      return z.boolean();
    case 'select':
      return z.enum(f.options.map((o) => o.value) as [string, ...string[]]);
    case 'multi':
      return z.array(z.string());
  }
}

export function detailsSchema(v: Vertical) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of v.fields) shape[f.name] = fieldSchema(f);
  let schema = z.object(shape);
  if (v.type === 'fuel_procurement') {
    // Mirrors the bowser-size CHECK on fuel_procurement_details.
    schema = schema.refine(
      (d) => d.delivery_type !== 'onsite_bowser_drop' || (Number(d.quantity_liters) >= 5000 && Number(d.quantity_liters) <= 40000),
      { path: ['quantity_liters'], message: 'Bowser drops are 5,000–40,000 L' },
    ) as unknown as typeof schema;
  }
  return schema;
}

export function detailDefaults(v: Vertical): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of v.fields) {
    if (f.kind === 'boolean') out[f.name] = f.default ?? false;
    else if (f.kind === 'select') out[f.name] = f.default ?? f.options[0]?.value;
    else if (f.kind === 'multi') out[f.name] = [];
    else out[f.name] = '';
  }
  return out;
}

/** Human-readable value for the detail view. */
export function displayValue(f: Field, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (f.kind) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'select':
      return f.options.find((o) => o.value === value)?.label ?? String(value);
    case 'multi':
      return Array.isArray(value) && value.length
        ? value.map((x) => f.options.find((o) => o.value === x)?.label ?? String(x)).join(', ')
        : '—';
    case 'number':
      return `${Number(value).toLocaleString('en-ZW')}${f.suffix ? ` ${f.suffix}` : ''}`;
    default:
      return String(value);
  }
}
