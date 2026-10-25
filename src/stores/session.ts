import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import type { CompanyRole } from '@/types/models';

export interface Membership {
  companyId: string;
  companyName: string;
  role: CompanyRole;
}

interface SessionState {
  session: Session | null;
  initialized: boolean;
  memberships: Membership[];
  /** False until the first memberships fetch completes — distinguishes "loading" from "no company". */
  membershipsLoaded: boolean;
  activeCompanyId: string | null;
  /**
   * True while a password reset is in progress. Verifying the reset code signs the user in,
   * and this keeps the root guard on the reset screen until the new password is saved.
   */
  recovering: boolean;
  setRecovering: (r: boolean) => void;
  setSession: (s: Session | null) => void;
  setMemberships: (m: Membership[]) => void;
  setActiveCompany: (id: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  initialized: false,
  memberships: [],
  membershipsLoaded: false,
  activeCompanyId: null,
  recovering: false,
  setRecovering: (recovering) => set({ recovering }),
  setSession: (session) =>
    set(session ? { session, initialized: true } : { session, initialized: true, memberships: [], membershipsLoaded: false, activeCompanyId: null }),
  setMemberships: (memberships) => {
    const current = get().activeCompanyId;
    const keep = memberships.some((m) => m.companyId === current);
    set({ memberships, membershipsLoaded: true, activeCompanyId: keep ? current : (memberships[0]?.companyId ?? null) });
  },
  setActiveCompany: (activeCompanyId) => set({ activeCompanyId }),
}));

export function useActiveMembership(): Membership | null {
  return useSessionStore((s) => s.memberships.find((m) => m.companyId === s.activeCompanyId) ?? null);
}

/** Mirrors has_company_role() in SQL: admin implicitly holds every role. UI hint only — RLS enforces. */
export function hasRole(m: Membership | null, ...roles: CompanyRole[]): boolean {
  return !!m && (m.role === 'admin' || roles.includes(m.role));
}
