import { useEffect, useState } from 'react';
import { Alert, Switch, Text, TextInput, View } from 'react-native';
import { Button, Card, SectionTitle } from '@/components/ui';
import { VERTICAL_LIST } from '@/features/listings/verticals';
import type { ListingType } from '@/types/models';
import { useCompany, useUpdateApprovalRules } from './api';

/** Admin-only: which posts need sign-off before going live. Off by default. */
export function ApprovalRules({ companyId }: { companyId: string }) {
  const company = useCompany(companyId);
  const save = useUpdateApprovalRules(companyId);
  const [types, setTypes] = useState<ListingType[]>([]);
  const [useThreshold, setUseThreshold] = useState(false);
  const [threshold, setThreshold] = useState('');

  const c = company.data;
  useEffect(() => {
    if (!c) return;
    setTypes(c.approval_required_types);
    setUseThreshold(c.finance_approval_threshold != null);
    setThreshold(c.finance_approval_threshold != null ? String(c.finance_approval_threshold) : '');
  }, [c]);
  if (!c) return null;

  const toggle = (t: ListingType, on: boolean) => setTypes((prev) => (on ? [...prev, t] : prev.filter((x) => x !== t)));
  const off = types.length === 0 && !useThreshold;

  const submit = () => {
    const amount = Number(threshold);
    if (useThreshold && !(amount > 0)) return Alert.alert('Budget limit', 'Enter an amount greater than 0.');
    save.mutate(
      { approval_required_types: types, finance_approval_threshold: useThreshold ? amount : null },
      {
        onSuccess: () => Alert.alert('Approval rules saved', off ? 'All posts now go live immediately.' : 'New posts follow these rules.'),
        onError: (e) => Alert.alert('Could not save', e.message),
      },
    );
  };

  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>Approval rules</SectionTitle>
        <Text className="text-sm text-slate-600 dark:text-slate-400">
          {off
            ? 'Off: every post goes live immediately. Turn on approval for the post types that need a second pair of eyes.'
            : 'Posts matching these rules wait in the Approvals tab. Nobody can approve their own post.'}
        </Text>

        <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">Require approval for</Text>
        {VERTICAL_LIST.map((v) => (
          <View key={v.type} className="flex-row items-center justify-between">
            <Text className="flex-1 text-slate-800 dark:text-slate-200">{v.label}</Text>
            <Switch value={types.includes(v.type)} onValueChange={(on) => toggle(v.type, on)} accessibilityLabel={`Require approval for ${v.label}`} />
          </View>
        ))}
        <Text className="text-xs text-slate-500">Approved by a procurement officer or admin (not the author).</Text>

        <View className="mt-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 font-medium text-slate-800 dark:text-slate-200">Finance sign-off above a budget</Text>
            <Switch value={useThreshold} onValueChange={setUseThreshold} accessibilityLabel="Require finance sign-off above a budget" />
          </View>
          {useThreshold ? (
            <TextInput
              value={threshold}
              onChangeText={setThreshold}
              keyboardType="decimal-pad"
              placeholder="e.g. 5000"
              accessibilityLabel="Budget limit"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base dark:bg-slate-800 dark:text-white"
            />
          ) : null}
          <Text className="text-xs text-slate-500">Any post with a budget above this also needs a finance approver.</Text>
        </View>

        <Button title="Save approval rules" variant="secondary" onPress={submit} loading={save.isPending} />
      </View>
    </Card>
  );
}
