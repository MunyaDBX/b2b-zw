import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

export const queryKeys = {
  memberships: (userId: string) => ['memberships', userId] as const,
  feed: (type: string | null) => ['listings', 'feed', type] as const,
  listing: (id: string) => ['listings', id] as const,
  proposals: (listingId: string) => ['proposals', listingId] as const,
  bidCount: (listingId: string) => ['proposals', listingId, 'count'] as const,
  approvals: (companyId: string) => ['approvals', companyId] as const,
};
