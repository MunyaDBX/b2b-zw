import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Badge, Button, Card, Chips, SectionTitle } from '@/components/ui';
import {
  ROLE_LABEL,
  useAddBranch,
  useAddMember,
  useBranches,
  useChangeRole,
  useCompany,
  useMembers,
  useRemoveMember,
  useUpdateCompany,
} from '@/features/company/api';
import { supabase } from '@/lib/supabase';
import { hasRole, useActiveMembership, useSessionStore } from '@/stores/session';
import type { CompanyRole } from '@/types/models';

const ROLES = (Object.keys(ROLE_LABEL) as CompanyRole[]).map((value) => ({ value, label: ROLE_LABEL[value] }));
const inputCls = 'rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base dark:bg-slate-800 dark:text-white';

function Members({ companyId, isAdmin, myUserId }: { companyId: string; isAdmin: boolean; myUserId: string | undefined }) {
  const members = useMembers(companyId);
  const add = useAddMember(companyId);
  const remove = useRemoveMember(companyId);
  const changeRole = useChangeRole(companyId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CompanyRole>('procurement_officer');
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>Team</SectionTitle>
        {members.data?.map((m) => (
          <View key={m.member_id} className="gap-2">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-slate-800 dark:text-slate-200" numberOfLines={1}>
                {m.email}
                {m.user_id === myUserId ? ' (you)' : ''}
              </Text>
              <Pressable disabled={!isAdmin} onPress={() => setEditing(editing === m.member_id ? null : m.member_id)} accessibilityLabel={`Change role for ${m.email}`}>
                <Badge label={isAdmin ? `${ROLE_LABEL[m.role]} ▾` : ROLE_LABEL[m.role]} />
              </Pressable>
              {isAdmin && m.user_id !== myUserId ? (
                <Pressable
                  onPress={() =>
                    Alert.alert('Remove member?', m.email, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(m.member_id, { onError: (e) => Alert.alert('Failed', e.message) }) },
                    ])
                  }
                >
                  <Text className="text-danger">Remove</Text>
                </Pressable>
              ) : null}
            </View>
            {editing === m.member_id ? (
              <Chips
                options={ROLES}
                value={m.role}
                onChange={(r) =>
                  changeRole.mutate(
                    { memberId: m.member_id, role: r },
                    { onSuccess: () => setEditing(null), onError: (e) => Alert.alert('Could not change role', e.message) },
                  )
                }
              />
            ) : null}
          </View>
        ))}
        {isAdmin ? (
          <View className="gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <Text className="text-sm text-slate-600 dark:text-slate-400">Add a colleague (they must have signed up first)</Text>
            <TextInput value={email} onChangeText={setEmail} placeholder="colleague@company.co.zw" autoCapitalize="none" keyboardType="email-address" className={inputCls} />
            <Chips options={ROLES} value={role} onChange={setRole} />
            <Button
              title="Add member"
              loading={add.isPending}
              disabled={!email.includes('@')}
              onPress={() =>
                add.mutate(
                  { email, role },
                  { onSuccess: () => setEmail(''), onError: (e) => Alert.alert('Could not add member', e.message) },
                )
              }
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function CompanyProfile({ companyId, isAdmin }: { companyId: string; isAdmin: boolean }) {
  const company = useCompany(companyId);
  const update = useUpdateCompany(companyId);
  const [draft, setDraft] = useState<{ name: string; vat: string; wa: string } | null>(null);
  const c = company.data;
  if (!c) return null;

  const save = () => {
    if (!draft) return;
    const wa = draft.wa.trim();
    if (draft.name.trim().length < 2) return Alert.alert('Company name is required');
    if (wa && !/^\+[1-9]\d{7,14}$/.test(wa)) return Alert.alert('WhatsApp number', 'Use international format, e.g. +263771234567');
    update.mutate(
      { company_name: draft.name.trim(), vat_tax_id: draft.vat.trim() || null, whatsapp_business_number: wa || null },
      { onSuccess: () => setDraft(null), onError: (e) => Alert.alert('Could not save', e.message) },
    );
  };

  return (
    <Card>
      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <SectionTitle>Company profile</SectionTitle>
          <View className="flex-row gap-1">
            {!c.is_registered ? <Badge label="Unregistered" /> : null}
            <Badge label={c.is_verified ? 'Verified' : 'Unverified'} tone={c.is_verified ? 'ok' : 'warn'} />
          </View>
        </View>
        {draft ? (
          <View className="gap-2">
            <TextInput value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="Company name" className={inputCls} />
            <TextInput value={draft.vat} onChangeText={(vat) => setDraft({ ...draft, vat })} placeholder="VAT / ZIMRA BP number" className={inputCls} />
            <TextInput value={draft.wa} onChangeText={(wa) => setDraft({ ...draft, wa })} placeholder="WhatsApp +263771234567" keyboardType="phone-pad" className={inputCls} />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button title="Cancel" variant="secondary" onPress={() => setDraft(null)} />
              </View>
              <View className="flex-1">
                <Button title="Save" onPress={save} loading={update.isPending} />
              </View>
            </View>
          </View>
        ) : (
          <>
            <Text className="text-base font-semibold text-slate-900 dark:text-white">{c.company_name}</Text>
            <Text className="text-slate-600 dark:text-slate-400">
              {c.is_registered ? 'Reg. no.' : 'Platform ref.'} {c.registration_number}
            </Text>
            <Text className="text-slate-600 dark:text-slate-400">VAT: {c.vat_tax_id ?? '—'}</Text>
            <Text className="text-slate-600 dark:text-slate-400">WhatsApp: {c.whatsapp_business_number ?? '—'}</Text>
            {isAdmin ? (
              <Button
                title="Edit company"
                variant="secondary"
                onPress={() => setDraft({ name: c.company_name, vat: c.vat_tax_id ?? '', wa: c.whatsapp_business_number ?? '' })}
              />
            ) : null}
          </>
        )}
      </View>
    </Card>
  );
}

function Branches({ companyId, isAdmin }: { companyId: string; isAdmin: boolean }) {
  const branches = useBranches(companyId);
  const add = useAddBranch(companyId);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>Branches</SectionTitle>
        {branches.data?.map((b) => (
          <View key={b.id} className="flex-row items-center justify-between">
            <Text className="text-slate-800 dark:text-slate-200">
              {b.branch_name}
              {b.city ? ` · ${b.city}` : ''}
            </Text>
            {b.is_head_office ? <Badge label="HQ" tone="ok" /> : null}
          </View>
        ))}
        {isAdmin ? (
          <View className="gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <TextInput value={name} onChangeText={setName} placeholder="Branch name" className={inputCls} />
            <TextInput value={city} onChangeText={setCity} placeholder="City" className={inputCls} />
            <Button
              title="Add branch"
              variant="secondary"
              disabled={name.trim().length < 2}
              loading={add.isPending}
              onPress={() =>
                add.mutate(
                  { name: name.trim(), city: city.trim() || undefined },
                  {
                    onSuccess: () => {
                      setName('');
                      setCity('');
                    },
                    onError: (e) => Alert.alert('Could not add branch', e.message),
                  },
                )
              }
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

export default function Company() {
  const membership = useActiveMembership();
  const { memberships, setActiveCompany, session } = useSessionStore();
  const name = (session?.user.user_metadata as { full_name?: string } | undefined)?.full_name;

  const accountCard = (
    <Card>
      <View className="gap-2">
        <SectionTitle>{name || 'My account'}</SectionTitle>
        <Text className="text-slate-600 dark:text-slate-400">{session?.user.email}</Text>
        <Button variant="secondary" title="Account settings" onPress={() => router.push('/account')} />
      </View>
    </Card>
  );

  // No company yet: still offer account settings and sign-out.
  if (!membership) {
    return (
      <ScrollView contentContainerClassName="gap-4 p-4 pb-16" className="bg-slate-50 dark:bg-slate-950">
        {accountCard}
        <Button title="Set up your company" onPress={() => router.push('/onboarding')} />
        <Button variant="danger" title="Sign out" onPress={() => void supabase.auth.signOut({ scope: 'local' })} />
      </ScrollView>
    );
  }
  const isAdmin = membership.role === 'admin';

  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-16" className="bg-slate-50 dark:bg-slate-950">
      {accountCard}
      {memberships.length > 1 ? (
        <Card>
          <View className="gap-2">
            <SectionTitle>Acting as</SectionTitle>
            <Chips
              options={memberships.map((m) => ({ value: m.companyId, label: m.companyName }))}
              value={membership.companyId}
              onChange={setActiveCompany}
            />
          </View>
        </Card>
      ) : null}
      <CompanyProfile companyId={membership.companyId} isAdmin={isAdmin} />
      <Members companyId={membership.companyId} isAdmin={isAdmin} myUserId={session?.user.id} />
      <Branches companyId={membership.companyId} isAdmin={isAdmin} />
      {hasRole(membership, 'logistics_manager') ? (
        <Button variant="secondary" title="Employee commute routes" onPress={() => router.push('/company/commute')} />
      ) : null}
      <Button variant="secondary" title="Register another company" onPress={() => router.push('/onboarding')} />
      <Button variant="danger" title="Sign out" onPress={() => void supabase.auth.signOut({ scope: 'local' })} />
    </ScrollView>
  );
}
