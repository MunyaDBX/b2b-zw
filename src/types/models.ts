import type { Enums, Tables } from './database';

export type ListingRow = Tables<'b2b_listings'>;
export type ProposalRow = Tables<'rfq_proposals'>;
export type AuctionBidRow = Tables<'auction_bids'>;
export type ApprovalRequestRow = Tables<'approval_requests'>;
export type FreightDispatchRow = Tables<'freight_dispatches'>;
export type InvoiceRow = Tables<'invoices'>;
export type EscrowRow = Tables<'escrow_transactions'>;
export type TradeFinanceRow = Tables<'trade_finance_requests'>;
export type BranchRow = Tables<'company_branches'>;
export type CommuteRouteRow = Tables<'commute_routes'>;

export type ListingType = Enums<'b2b_listing_type'>;
export type ApprovalStatus = Enums<'approval_status_enum'>;
export type CompanyRole = Enums<'company_role_enum'>;
export type CompanyType = Enums<'company_type_enum'>;
export type FreightStatus = Enums<'freight_status_enum'>;
export type FinanceStatus = Enums<'finance_status_enum'>;
