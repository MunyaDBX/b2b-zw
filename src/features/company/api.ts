import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, unwrap } from '@/lib/supabase';
import type { BranchRow, CommuteRouteRow, CompanyRole } from '@/types/models';

export function useMembers(companyId: string | null) {
  return useQuery({
    queryKey: ['company', companyId, 'members'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('list_company_members', { p_company: companyId! })),
  });
}

export function useAddMember(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { email: string; role: CompanyRole; branchId?: string }) =>
      unwrap(
        await supabase.rpc('add_company_member', {
          p_company: companyId!,
          p_email: a.email,
          p_role: a.role,
          p_branch: a.branchId,
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['company', companyId] }),
  });
}

export function useChangeRole(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { memberId: string; role: CompanyRole }) => {
      // RLS: admins only. The keep_one_admin trigger blocks demoting the last admin.
      const { error } = await supabase.from('company_users').update({ role: a.role }).eq('id', a.memberId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['company', companyId] });
      void qc.invalidateQueries({ queryKey: ['memberships'] });
    },
  });
}

export function useCompany(companyId: string | null) {
  return useQuery({
    queryKey: ['company', companyId, 'profile'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('companies').select('*').eq('id', companyId!).single()),
  });
}

export function useUpdateCompany(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { company_name: string; vat_tax_id: string | null; whatsapp_business_number: string | null }) => {
      // Only these columns are granted to clients; verification and credit stay platform-controlled.
      const { error } = await supabase.from('companies').update(a).eq('id', companyId!);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['company', companyId] });
      void qc.invalidateQueries({ queryKey: ['memberships'] });
    },
  });
}

export function useRemoveMember(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('company_users').delete().eq('id', memberId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['company', companyId] }),
  });
}

export function useBranches(companyId: string | null) {
  return useQuery({
    queryKey: ['company', companyId, 'branches'],
    enabled: !!companyId,
    queryFn: async (): Promise<BranchRow[]> =>
      unwrap(await supabase.from('company_branches').select('*').eq('company_id', companyId!).order('created_at')),
  });
}

export function useAddBranch(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { name: string; city?: string }) => {
      const { error } = await supabase
        .from('company_branches')
        .insert({ company_id: companyId!, branch_name: a.name, city: a.city ?? null });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['company', companyId] }),
  });
}

export function useCommuteRoutes(companyId: string | null) {
  return useQuery({
    queryKey: ['company', companyId, 'commute'],
    enabled: !!companyId,
    queryFn: async (): Promise<CommuteRouteRow[]> =>
      unwrap(await supabase.from('commute_routes').select('*').eq('company_id', companyId!).order('route_name')),
  });
}

export function useAddCommuteRoute(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { name: string; seats: number; stops: string[]; times: string[] }) => {
      const { error } = await supabase.from('commute_routes').insert({
        company_id: companyId!,
        route_name: a.name,
        seats: a.seats,
        stops: a.stops.map((name) => ({ name })),
        departure_times: a.times,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['company', companyId, 'commute'] }),
  });
}

export function useToggleRoute(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string; active: boolean }) => {
      const { error } = await supabase.from('commute_routes').update({ active: a.active }).eq('id', a.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['company', companyId, 'commute'] }),
  });
}

export const ROLE_LABEL: Record<CompanyRole, string> = {
  admin: 'Admin',
  procurement_officer: 'Procurement',
  finance_approver: 'Finance',
  logistics_manager: 'Logistics',
  driver: 'Driver',
};
