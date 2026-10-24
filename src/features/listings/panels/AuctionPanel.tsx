import { Gavel } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { Badge, Button, Card, SectionTitle } from '@/components/ui';
import { formatMoney, timeLeft } from '@/lib/format';
import { hasRole, useActiveMembership, useSessionStore } from '@/stores/session';
import type { ListingRow } from '@/types/models';
import { useAuctionBids, useCloseAuction, usePlaceBid, useReserveMet } from '../api';

/** Minimum increment: 1% of the current high bid, at least 10 currency units. */
const nextMinimum = (high: number) => high + Math.max(10, Math.ceil(high * 0.01));

export function AuctionPanel({ listing, isOwner }: { listing: ListingRow; isOwner: boolean }) {
  const membership = useActiveMembership();
  const userId = useSessionStore((s) => s.session?.user.id);
  const live = listing.approval_status === 'approved';
  const bids = useAuctionBids(listing.id, live);
  const reserveMet = useReserveMet(listing.id, live);
  const place = usePlaceBid(listing.id, membership?.companyId ?? null, userId);
  const close = useCloseAuction(listing.id);
  const [amount, setAmount] = useState('');

  const high = bids.data?.[0]?.amount ?? listing.budget_or_target_price ?? 0;
  const ended = !!listing.bidding_closes_at && new Date(listing.bidding_closes_at) <= new Date();
  const minBid = bids.data?.length ? nextMinimum(high) : high || 1;
  const leading = !!bids.data?.[0] && bids.data[0].bidder_company_id === membership?.companyId;

  return (
    <Card>
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Gavel size={18} color="#0F4C81" />
            <SectionTitle>Live auction</SectionTitle>
          </View>
          <Text className="text-slate-500">{timeLeft(listing.bidding_closes_at)}</Text>
        </View>
        <Text className="text-3xl font-bold text-slate-900 dark:text-white">{formatMoney(high, listing.currency)}</Text>
        <View className="flex-row gap-2">
          <Badge label={`${bids.data?.length ?? 0} bids`} />
          {reserveMet.data !== undefined ? (
            <Badge label={reserveMet.data ? 'Reserve met' : 'Reserve not met'} tone={reserveMet.data ? 'ok' : 'warn'} />
          ) : null}
          {leading ? <Badge label="You're leading" tone="ok" /> : null}
        </View>

        {!isOwner && !ended && listing.status === 'open' && hasRole(membership, 'procurement_officer') ? (
          <View className="gap-2">
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder={`Minimum ${formatMoney(minBid, listing.currency)}`}
              accessibilityLabel="Bid amount"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base dark:bg-slate-800 dark:text-white"
            />
            <Button
              title="Place bid"
              loading={place.isPending}
              onPress={() => {
                const n = Number(amount);
                if (!Number.isFinite(n) || n < minBid) {
                  Alert.alert('Bid too low', `Minimum bid is ${formatMoney(minBid, listing.currency)}.`);
                  return;
                }
                place.mutate(n, { onSuccess: () => setAmount(''), onError: (e) => Alert.alert('Bid rejected', e.message) });
              }}
            />
          </View>
        ) : null}

        {isOwner && ended && listing.status === 'open' ? (
          <Button
            title="Close auction & declare result"
            loading={close.isPending}
            onPress={() =>
              close.mutate(undefined, {
                onSuccess: (r) =>
                  Alert.alert(r.sold ? 'Sold' : 'Reserve not met', r.sold ? `Sold for ${formatMoney(r.amount, listing.currency)}.` : 'The asset was not sold.'),
                onError: (e) => Alert.alert('Could not close', e.message),
              })
            }
          />
        ) : null}

        {bids.data?.slice(0, 10).map((b, i) => (
          <View key={b.id} className="flex-row justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
            <Text className="text-slate-600 dark:text-slate-400">
              {i === 0 ? 'Leading · ' : ''}
              {new Date(b.created_at).toLocaleTimeString()}
            </Text>
            <Text className="font-medium text-slate-900 dark:text-white">{formatMoney(b.amount, listing.currency)}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
