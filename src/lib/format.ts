export function formatMoney(amount: number | null | undefined, currency = 'USD'): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-ZW', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

export function timeLeft(iso: string | null): string {
  if (!iso) return 'No deadline';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)}d left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

export const LISTING_TYPE_LABEL: Record<string, string> = {
  rfq_procurement: 'RFQ',
  asset_auction: 'Auction',
  commercial_property: 'Property',
  freight_haulage: 'Freight',
  sla_service: 'SLA Service',
  plant_machinery: 'Plant Hire',
  agri_offtake: 'Agri Off-take',
  fuel_procurement: 'Bulk Fuel',
  storage_space: 'Storage',
};
