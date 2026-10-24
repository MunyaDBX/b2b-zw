import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase, unwrap } from '@/lib/supabase';
import type { EscrowRow, FinanceStatus, InvoiceRow, TradeFinanceRow } from '@/types/models';

export const tradeFinanceSchema = z.object({
  poRef: z.string().trim().min(2, 'PO / invoice reference is required'),
  debtor: z.string().trim().min(2, 'Debtor company is required'),
  amount: z.coerce.number({ invalid_type_error: 'Enter a number' }).positive('Must be greater than 0'),
  currency: z.enum(['USD', 'ZWG', 'ZAR']),
  advancePct: z.coerce.number().min(1).max(95, 'Maximum advance is 95%'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine((d) => new Date(d) > new Date(), 'Due date must be in the future'),
});
export type TradeFinanceInput = z.input<typeof tradeFinanceSchema>;
export type TradeFinanceValues = z.output<typeof tradeFinanceSchema>;

export function useTradeFinance(companyId: string | null) {
  return useQuery({
    queryKey: ['finance', 'tf', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<TradeFinanceRow[]> =>
      unwrap(
        await supabase.from('trade_finance_requests').select('*').eq('company_id', companyId!).order('created_at', { ascending: false }),
      ),
  });
}

export function useCreateTradeFinance(companyId: string | null, userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: TradeFinanceValues & { attachmentId: string }) => {
      if (!companyId || !userId) throw new Error('Select a company first');
      const { error } = await supabase.from('trade_finance_requests').insert({
        company_id: companyId,
        requested_by_user_id: userId,
        purchase_order_ref: v.poRef,
        debtor_company_name: v.debtor,
        invoice_amount: v.amount,
        currency: v.currency,
        advance_requested_percentage: v.advancePct,
        due_date: v.dueDate,
        invoice_attachment_id: v.attachmentId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['finance'] }),
  });
}

export function useInvoices(companyId: string | null) {
  return useQuery({
    queryKey: ['finance', 'invoices', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<{ invoices: InvoiceRow[]; escrows: EscrowRow[] }> => {
      const invoices = unwrap(
        await supabase
          .from('invoices')
          .select('*')
          .or(`issuer_company_id.eq.${companyId},payer_company_id.eq.${companyId}`)
          .order('created_at', { ascending: false })
          .limit(100),
      );
      const ids = invoices.map((i) => i.id);
      const escrows = ids.length ? unwrap(await supabase.from('escrow_transactions').select('*').in('invoice_id', ids)) : [];
      return { invoices, escrows };
    },
  });
}

export function useIssueInvoice(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { proposalId: string; invoiceNumber: string }) =>
      unwrap(await supabase.rpc('issue_invoice', { p_proposal: args.proposalId, p_invoice_number: args.invoiceNumber })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance'] });
      void qc.invalidateQueries({ queryKey: ['listings', listingId] });
    },
  });
}

export function useAcceptDelivery(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('accept_delivery', { p_listing: listingId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['finance'] }),
  });
}

export function useListingEscrow(listingId: string) {
  return useQuery({
    queryKey: ['finance', 'escrow', listingId],
    queryFn: async (): Promise<EscrowRow[]> =>
      unwrap(await supabase.from('escrow_transactions').select('*').eq('listing_id', listingId)),
  });
}

// ---- Platform operator review ----
export function useIsPlatformAdmin(enabled: boolean) {
  return useQuery({
    queryKey: ['platform-admin'],
    enabled,
    staleTime: Infinity,
    queryFn: async () => unwrap(await supabase.rpc('is_platform_admin')),
  });
}

export function useReviewQueue(enabled: boolean) {
  return useQuery({
    queryKey: ['finance', 'review'],
    enabled,
    queryFn: async (): Promise<TradeFinanceRow[]> =>
      unwrap(
        await supabase
          .from('trade_finance_requests')
          .select('*')
          .in('status', ['under_review', 'approved', 'funded'])
          .order('created_at', { ascending: true }),
      ),
  });
}

export function useReviewTradeFinance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string; status: FinanceStatus; note?: string; rate?: number }) => {
      const { error } = await supabase.rpc('review_trade_finance', {
        p_request: a.id,
        p_status: a.status,
        p_note: a.note,
        p_discount_rate_pct: a.rate,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['finance'] }),
  });
}

export const FINANCE_TONE: Record<FinanceStatus, 'neutral' | 'ok' | 'warn' | 'danger'> = {
  under_review: 'warn',
  approved: 'ok',
  funded: 'ok',
  settled: 'neutral',
  rejected: 'danger',
};
