import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import type { FreightDispatchRow, FreightStatus, ListingRow } from '@/types/models';

export type Job = FreightDispatchRow & { listing: Pick<ListingRow, 'id' | 'title' | 'currency'> | null };

/** Dispatches where my company is the carrier, or I am the assigned driver. */
export function useMyJobs(companyId: string | null, userId: string | undefined) {
  return useQuery({
    queryKey: ['jobs', companyId, userId],
    enabled: !!userId,
    queryFn: async (): Promise<Job[]> => {
      const filters = [`driver_user_id.eq.${userId}`];
      if (companyId) filters.push(`carrier_company_id.eq.${companyId}`);
      const jobs = unwrap(
        await supabase.from('freight_dispatches').select('*').or(filters.join(',')).neq('dispatch_status', 'cancelled'),
      );
      const ids = jobs.map((j) => j.listing_id);
      const listings = ids.length
        ? unwrap(await supabase.from('b2b_listings').select('id, title, currency').in('id', ids))
        : [];
      const byId = new Map(listings.map((l) => [l.id, l]));
      return jobs.map((j) => ({ ...j, listing: byId.get(j.listing_id) ?? null }));
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, listingId: string) {
  void qc.invalidateQueries({ queryKey: ['jobs'] });
  void qc.invalidateQueries({ queryKey: ['listings', listingId] });
}

export function useUpdateDispatch(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { status?: FreightStatus; driverId?: string }) =>
      unwrap(await supabase.rpc('update_dispatch', { p_listing: listingId, p_status: args.status, p_driver: args.driverId })),
    onSuccess: () => invalidate(qc, listingId),
  });
}

export function useConfirmDelivery(listingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      const { error } = await supabase.rpc('confirm_delivery', { p_listing: listingId, p_pod_attachment: attachmentId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidate(qc, listingId),
  });
}

export const NEXT_STATUS: Partial<Record<FreightStatus, FreightStatus>> = { assigned: 'loaded', loaded: 'in_transit' };
export const STATUS_STEPS: FreightStatus[] = ['posted', 'assigned', 'loaded', 'in_transit', 'delivered'];
