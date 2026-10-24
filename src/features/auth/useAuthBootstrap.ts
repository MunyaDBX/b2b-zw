import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '@/lib/queryClient';
import { supabase, unwrap } from '@/lib/supabase';
import { useSessionStore, type Membership } from '@/stores/session';

/** Subscribes to auth changes and loads the user's company memberships. */
export function useAuthBootstrap(): void {
  const { session, setSession, setMemberships } = useSessionStore();
  const userId = session?.user.id;

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [setSession]);

  const memberships = useQuery({
    queryKey: queryKeys.memberships(userId ?? 'anon'),
    enabled: !!userId,
    queryFn: async (): Promise<Membership[]> => {
      const rows = unwrap(
        await supabase
          .from('company_users')
          .select('company_id, role, companies(company_name)')
          .eq('user_id', userId!),
      ) as unknown as { company_id: string; role: Membership['role']; companies: { company_name: string } | null }[];
      return rows.map((r) => ({ companyId: r.company_id, role: r.role, companyName: r.companies?.company_name ?? '' }));
    },
  });

  useEffect(() => {
    if (memberships.data) setMemberships(memberships.data);
  }, [memberships.data, setMemberships]);
}
