import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId } from 'react';
import { queryKeys } from '@/lib/queryClient';
import { supabase, unwrap } from '@/lib/supabase';
import type { ApprovalRequestRow, ListingRow, ListingType, ProposalRow } from '@/types/models';
import type { ProposalValues } from './schemas';

const PAGE = 30;

export function useListingFeed(type: ListingType | null) {
  return useQuery({
    queryKey: queryKeys.feed(type),
    queryFn: async (): Promise<ListingRow[]> => {
      let q = supabase
        .from('b2b_listings')
        .select('*')
        .eq('approval_status', 'approved')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (type) q = q.eq('listing_type', type);
      return unwrap(await q);
    },
  });
}

export function useListing(id: string) {
  return useQuery({
    queryKey: queryKeys.listing(id),
    queryFn: async (): Promise<ListingRow> =>
      unwrap(await supabase.from('b2b_listings').select('*').eq('id', id).single()),
  });
}

/** RLS returns only the caller's own proposal while sealed; all proposals to the buyer after close. */
export function useProposals(listingId: string) {
  const qc = useQueryClient();
  // Unique per hook instance: supabase.channel() returns an already-subscribed channel
  // for a repeated name, and adding listeners to it throws.
  const instance = useId();
  useEffect(() => {
    const channel = supabase
      .channel(`proposals:${listingId}:${instance}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rfq_proposals', filter: `listing_id=eq.${listingId}` },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.proposals(listingId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [listingId, instance, qc]);

  return useQuery({
    queryKey: queryKeys.proposals(listingId),
    queryFn: async (): Promise<ProposalRow[]> =>
      unwrap(
        await supabase
          .from('rfq_proposals')
          .select('*')
          .eq('listing_id', listingId)
          .order('bid_amount', { ascending: true }),
      ),
  });
}

export function useBidCount(listingId: string) {
  return useQuery({
    queryKey: queryKeys.bidCount(listingId),
    queryFn: async (): Promise<number> =>
      unwrap(await supabase.rpc('rfq_bid_count', { p_listing: listingId })),
  });
}

export function useSubmitProposal(listingId: string, vendorCompanyId: string | null, userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: ProposalValues) => {
      if (!vendorCompanyId || !userId) throw new Error('Select a company first');
      const listing = qc.getQueryData<ListingRow>(queryKeys.listing(listingId));
      // Upsert so a vendor can revise their sealed bid until close.
      return unwrap(
        await supabase
          .from('rfq_proposals')
          .upsert(
            {
              listing_id: listingId,
              vendor_company_id: vendorCompanyId,
              submitted_by_user_id: userId,
              bid_amount: v.bidAmount,
              currency: listing?.currency ?? 'USD',
              delivery_timeline_days: v.deliveryDays,
              notes: v.notes ?? null,
              status: 'submitted',
            },
            { onConflict: 'listing_id,vendor_company_id' },
          )
          .select()
          .single(),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.proposals(listingId) });
      void qc.invalidateQueries({ queryKey: queryKeys.bidCount(listingId) });
    },
  });
}

export function useAwardProposal(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (proposalId: string) => {
      const { error } = await supabase.rpc('award_proposal', { p_proposal: proposalId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.listing(listingId) });
      void qc.invalidateQueries({ queryKey: queryKeys.proposals(listingId) });
      void qc.invalidateQueries({ queryKey: ['listings', 'feed'] });
    },
  });
}

export type ApprovalWithListing = ApprovalRequestRow & { listing: Pick<ListingRow, 'title' | 'budget_or_target_price' | 'currency' | 'created_by_user_id'> | null };

export function useApprovalInbox(companyId: string | null) {
  return useQuery({
    queryKey: queryKeys.approvals(companyId ?? 'none'),
    enabled: !!companyId,
    queryFn: async (): Promise<ApprovalWithListing[]> => {
      const rows = unwrap(
        await supabase
          .from('approval_requests')
          .select('*')
          .eq('company_id', companyId!)
          .eq('status', 'pending')
          .order('created_at', { ascending: true }),
      );
      const ids = [...new Set(rows.map((r) => r.entity_id))];
      const listings = ids.length
        ? unwrap(
            await supabase
              .from('b2b_listings')
              .select('id, title, budget_or_target_price, currency, created_by_user_id')
              .in('id', ids),
          )
        : [];
      const byId = new Map(listings.map((l) => [l.id, l]));
      return rows.map((r) => ({ ...r, listing: byId.get(r.entity_id) ?? null }));
    },
  });
}

export function useDecideApproval(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { requestId: string; approve: boolean; note?: string }) =>
      unwrap(
        await supabase.rpc('decide_approval', {
          p_request: args.requestId,
          p_approve: args.approve,
          p_note: args.note,
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.approvals(companyId ?? 'none') });
      void qc.invalidateQueries({ queryKey: ['listings'] });
    },
  });
}
