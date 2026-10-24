import { ShieldCheck } from 'lucide-react-native';
import { Alert, Text, View } from 'react-native';
import { Badge, Button, Card, SectionTitle } from '@/components/ui';
import { useAcceptDelivery, useListingEscrow } from '@/features/finance/api';
import { formatMoney } from '@/lib/format';
import { hasRole, useActiveMembership } from '@/stores/session';
import type { ListingRow } from '@/types/models';

const TONE = { pending_funding: 'warn', funded: 'ok', released: 'neutral', refunded: 'neutral', disputed: 'danger' } as const;

export function EscrowPanel({ listing, isOwner }: { listing: ListingRow; isOwner: boolean }) {
  const membership = useActiveMembership();
  const escrows = useListingEscrow(listing.id);
  const accept = useAcceptDelivery(listing.id);
  const e = escrows.data?.[0];
  if (!e) return null;

  return (
    <Card>
      <View className="gap-2">
        <View className="flex-row items-center gap-2">
          <ShieldCheck size={18} color="#15803D" />
          <SectionTitle>Escrow</SectionTitle>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-slate-900 dark:text-white">{formatMoney(e.amount, e.currency)}</Text>
          <Badge label={e.status.replace('_', ' ')} tone={TONE[e.status]} />
        </View>
        <Text className="text-slate-600 dark:text-slate-400">
          Releases on {e.release_condition === 'epod_confirmed' ? 'confirmed proof of delivery' : 'buyer acceptance'}.
        </Text>
        {isOwner && e.status === 'funded' && e.release_condition === 'buyer_acceptance' && hasRole(membership, 'procurement_officer', 'finance_approver') ? (
          <Button
            title="Accept delivery & release funds"
            loading={accept.isPending}
            onPress={() =>
              Alert.alert('Release escrow?', 'Confirm the goods or services were received as specified.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Release', onPress: () => accept.mutate(undefined, { onError: (err) => Alert.alert('Failed', err.message) }) },
              ])
            }
          />
        ) : null}
      </View>
    </Card>
  );
}
