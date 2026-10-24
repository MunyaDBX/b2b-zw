import { Linking } from 'react-native';
import { formatMoney } from '@/lib/format';
import type { ListingRow, ListingType } from '@/types/models';

export interface QuoteContext {
  listing: Pick<ListingRow, 'id' | 'title' | 'listing_type' | 'currency' | 'budget_or_target_price' | 'delivery_location' | 'bidding_closes_at'>;
  senderCompany: string;
  senderName?: string;
  /** Extra fields shown in the quote, e.g. { 'Quantity': '20,000 L' }. */
  extras?: Record<string, string>;
}

const INTRO: Record<ListingType, string> = {
  rfq_procurement: 'Formal quotation request in response to your RFQ',
  asset_auction: 'Enquiry regarding your surplus asset listing',
  commercial_property: 'Enquiry regarding your commercial property listing',
  freight_haulage: 'Haulage quotation for your freight job',
  sla_service: 'Service proposal for your SLA requirement',
  plant_machinery: 'Plant hire enquiry',
  agri_offtake: 'Off-take contract enquiry',
  fuel_procurement: 'Bulk fuel supply quotation',
  storage_space: 'Storage space enquiry',
};

/** Builds the structured, plain-text quotation body (WhatsApp renders *bold*). */
export function buildQuoteMessage(ctx: QuoteContext): string {
  const { listing } = ctx;
  const ref = `B2B-${listing.id.slice(0, 8).toUpperCase()}`;
  const lines = [
    `*${INTRO[listing.listing_type]}*`,
    '',
    `*Ref:* ${ref}`,
    `*Listing:* ${listing.title}`,
    listing.budget_or_target_price != null
      ? `*Target:* ${formatMoney(listing.budget_or_target_price, listing.currency)}`
      : null,
    listing.delivery_location ? `*Location:* ${listing.delivery_location}` : null,
    ...Object.entries(ctx.extras ?? {}).map(([k, v]) => `*${k}:* ${v}`),
    '',
    `*From:* ${ctx.senderCompany}${ctx.senderName ? ` (${ctx.senderName})` : ''}`,
    '',
    'Please confirm availability, pricing (excl./incl. VAT) and lead time.',
    `Sent via B2B ZW · b2bzw://listing/${listing.id}`,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export function whatsappUrl(e164: string, message: string): string {
  return `https://wa.me/${e164.replace(/[^\d]/g, '')}?text=${encodeURIComponent(message)}`;
}

export async function openWhatsAppQuote(e164: string, ctx: QuoteContext): Promise<void> {
  await Linking.openURL(whatsappUrl(e164, buildQuoteMessage(ctx)));
}
