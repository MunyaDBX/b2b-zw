import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase, unwrap } from '@/lib/supabase';
import { uploadFile, type LocalFile } from '@/lib/uploads';
import type { Json } from '@/types/database';
import type { AuctionBidRow, ListingType } from '@/types/models';

export interface CreateListingPayload {
  listing: {
    listing_type: ListingType;
    title: string;
    category: string;
    description?: string;
    budget_or_target_price?: number;
    reserve_price?: number;
    currency: string;
    payment_terms: string;
    delivery_location?: string;
    whatsapp_business_number?: string;
    contact_person?: string;
    contact_phone?: string;
    contact_email?: string;
    contact_address?: string;
    bidding_closes_at?: string;
  };
  details?: Record<string, unknown>;
  files?: LocalFile[];
}

export function useCreateListing(companyId: string | null, userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: CreateListingPayload) => {
      if (!companyId || !userId) throw new Error('Select a company first');
      const res = unwrap(
        await supabase.rpc('create_listing', {
          p_company: companyId,
          p_listing: p.listing as unknown as Json,
          p_details: p.details as Json | undefined,
        }),
      ) as { id: string; approval_status: string };

      // Files go up after the listing exists (attachments must point at our own listing).
      // A failed upload doesn't undo the listing; report which files didn't make it.
      const failed: string[] = [];
      for (const [i, file] of (p.files ?? []).entries()) {
        try {
          await uploadFile(file, { companyId, userId, listingId: res.id, sortOrder: i });
        } catch {
          failed.push(file.name);
        }
      }
      return { ...res, failedUploads: failed };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['listings'] });
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

export function useListingDetails(listingId: string) {
  return useQuery({
    queryKey: ['listings', listingId, 'details'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_listing_details', { p_listing: listingId });
      if (error) throw new Error(error.message);
      return (data ?? null) as Record<string, unknown> | null;
    },
  });
}

export function useAuctionBids(listingId: string, enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase
      .channel(`auction:${listingId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auction_bids', filter: `listing_id=eq.${listingId}` }, () => {
        void qc.invalidateQueries({ queryKey: ['auction', listingId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [listingId, enabled, qc]);

  return useQuery({
    queryKey: ['auction', listingId],
    enabled,
    queryFn: async (): Promise<AuctionBidRow[]> =>
      unwrap(
        await supabase.from('auction_bids').select('*').eq('listing_id', listingId).order('amount', { ascending: false }).limit(50),
      ),
  });
}

export function usePlaceBid(listingId: string, companyId: string | null, userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (amount: number) => {
      if (!companyId || !userId) throw new Error('Select a company first');
      const { error } = await supabase
        .from('auction_bids')
        .insert({ listing_id: listingId, bidder_company_id: companyId, bidder_user_id: userId, amount });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['auction', listingId] }),
  });
}

export function useReserveMet(listingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['auction', listingId, 'reserve'],
    enabled,
    queryFn: async () => unwrap(await supabase.rpc('auction_reserve_met', { p_listing: listingId })),
  });
}

export function useCloseAuction(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = unwrap(await supabase.rpc('close_auction', { p_listing: listingId }));
      return res as { sold: boolean; amount: number | null };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['listings'] }),
  });
}
