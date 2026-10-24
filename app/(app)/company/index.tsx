import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Badge, Button, Card, Chips, SectionTitle } from '@/components/ui';
import { ROLE_LABEL, useAddBranch, useAddMember, useBranches, useMembers, useRemoveMember } from '@/features/company/api';
import { supabase } from '@/lib/supabase';
import { hasRole, useActiveMembership, useSessionStore } from '@/stores/session';
import type { CompanyRole } from '@/types/models';

const ROLES = (Object.keys(ROLE_LABEL) as CompanyRole[]).map((value) => ({ value, label: ROLE_LABEL[value] }));
const inputCls = 'rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base dark:bg-slate-800 dark:text-white';

function Members({ companyId, isAdmin, myUserId }: { companyId: string; isAdmin: boolean; myUserId: string | undefined }) {
  const members = useMembers(companyId);
  const add = useAddMember(companyId);
  const remove = useRemoveMember(companyId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CompanyRole>('procurement_officer');

  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>Team</SectionTitle>
        {members.data?.map((m) => (
          <View key={m.member_id} className="flex-row items-center justify-between gap-2">
            <Text className="flex-1 text-slate-800 dark:text-slate-200" numberOfLines={1}>
              {m.email}
            </Text>
            <Badge label={ROLE_LABEL[m.role]} />
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
  if (!membership) return null;
  const isAdmin = membership.role === 'admin';

  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-16" className="bg-slate-50 dark:bg-slate-950">
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
      <Members companyId={membership.companyId} isAdmin={isAdmin} myUserId={session?.user.id} />
      <Branches companyId={membership.companyId} isAdmin={isAdmin} />
      {hasRole(membership, 'logistics_manager') ? (
        <Button variant="secondary" title="Employee commute routes" onPress={() => router.push('/company/commute')} />
      ) : null}
      <Button variant="secondary" title="Register another company" onPress={() => router.push('/onboarding')} />
      <Button variant="danger" title="Sign out" onPress={() => void supabase.auth.signOut()} />
    </ScrollView>
  );
}
