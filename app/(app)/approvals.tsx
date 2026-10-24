import { FlashList } from '@shopify/flash-list';
import { Link } from 'expo-router';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { Badge, Button, Card, Centered } from '@/components/ui';
import { useApprovalInbox, useDecideApproval, type ApprovalWithListing } from '@/features/rfq/api';
import { formatMoney } from '@/lib/format';
import { hasRole, useActiveMembership, useSessionStore } from '@/stores/session';

function ApprovalItem({ item }: { item: ApprovalWithListing }) {
  const membership = useActiveMembership();
  const userId = useSessionStore((s) => s.session?.user.id);
  const decide = useDecideApproval(membership?.companyId ?? null);
  const ownSubmission = item.listing?.created_by_user_id === userId;
  const canDecide = hasRole(membership, item.required_role) && !ownSubmission;

  const run = (approve: boolean) =>
    decide.mutate(
      { requestId: item.id, approve },
      { onError: (e) => Alert.alert('Could not record decision', e.message) },
    );

  return (
    <View className="px-4 py-2">
      <Card>
        <View className="flex-row items-center justify-between">
          <Badge label={`Step ${item.step_order} · ${item.required_role.replace('_', ' ')}`} tone="warn" />
          <Link href={{ pathname: '/listing/[id]', params: { id: item.entity_id } }} className="text-brand underline">
            View
          </Link>
        </View>
        <Text className="mt-2 text-base font-semibold text-slate-900 dark:text-white">{item.listing?.title ?? 'Listing'}</Text>
        <Text className="text-slate-600 dark:text-slate-400">
          {formatMoney(item.listing?.budget_or_target_price, item.listing?.currency)}
        </Text>
        {canDecide ? (
          <View className="mt-3 flex-row gap-3">
            <View className="flex-1">
              <Button title="Reject" variant="danger" onPress={() => run(false)} disabled={decide.isPending} />
            </View>
            <View className="flex-1">
              <Button title="Approve" onPress={() => run(true)} loading={decide.isPending} />
            </View>
          </View>
        ) : (
          <Text className="mt-2 text-xs text-slate-500">
            {ownSubmission ? 'You submitted this — another approver must decide.' : `Awaiting a ${item.required_role.replace('_', ' ')}.`}
          </Text>
        )}
      </Card>
    </View>
  );
}

export default function Approvals() {
  const membership = useActiveMembership();
  const inbox = useApprovalInbox(membership?.companyId ?? null);

  if (inbox.isPending) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <FlashList
        data={inbox.data ?? []}
        keyExtractor={(a) => a.id}
        estimatedItemSize={160}
        renderItem={({ item }) => <ApprovalItem item={item} />}
        onRefresh={() => void inbox.refetch()}
        refreshing={inbox.isRefetching}
        ListEmptyComponent={<Text className="p-8 text-center text-slate-500">Nothing awaiting approval.</Text>}
      />
    </View>
  );
}
