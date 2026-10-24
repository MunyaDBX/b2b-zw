import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { Badge, Button, Card, Centered, Row } from '@/components/ui';
import { FINANCE_TONE, useIsPlatformAdmin, useReviewQueue, useReviewTradeFinance } from '@/features/finance/api';
import { formatMoney } from '@/lib/format';
import type { FinanceStatus, TradeFinanceRow } from '@/types/models';

function ReviewCard({ r }: { r: TradeFinanceRow }) {
  const review = useReviewTradeFinance();
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const act = (status: FinanceStatus) =>
    review.mutate(
      { id: r.id, status, note: note || undefined, rate: rate ? Number(rate) : undefined },
      { onError: (e) => Alert.alert('Review failed', e.message) },
    );

  return (
    <Card>
      <View className="gap-1">
        <View className="flex-row items-center justify-between">
          <Text className="font-semibold text-slate-900 dark:text-white">{r.purchase_order_ref}</Text>
          <Badge label={r.status.replace('_', ' ')} tone={FINANCE_TONE[r.status]} />
        </View>
        <Row label="Debtor" value={r.debtor_company_name} />
        <Row label="Invoice" value={formatMoney(r.invoice_amount, r.currency)} />
        <Row label="Advance" value={`${r.advance_requested_percentage}%`} />
        <Row label="Due" value={r.due_date} />
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Reviewer note"
          className="mt-2 rounded-xl border border-slate-300 bg-white px-3 py-2 dark:bg-slate-800 dark:text-white"
        />
        {r.status === 'under_review' ? (
          <>
            <TextInput
              value={rate}
              onChangeText={setRate}
              keyboardType="decimal-pad"
              placeholder="Discount rate % (required to approve)"
              className="mt-2 rounded-xl border border-slate-300 bg-white px-3 py-2 dark:bg-slate-800 dark:text-white"
            />
            <View className="mt-2 flex-row gap-3">
              <View className="flex-1">
                <Button title="Reject" variant="danger" onPress={() => act('rejected')} disabled={review.isPending} />
              </View>
              <View className="flex-1">
                <Button title="Approve" onPress={() => act('approved')} loading={review.isPending} disabled={!rate} />
              </View>
            </View>
          </>
        ) : r.status === 'approved' ? (
          <View className="mt-2">
            <Button title="Mark funded" onPress={() => act('funded')} loading={review.isPending} />
          </View>
        ) : (
          <View className="mt-2">
            <Button title="Mark settled" onPress={() => act('settled')} loading={review.isPending} />
          </View>
        )}
      </View>
    </Card>
  );
}

export default function Review() {
  const admin = useIsPlatformAdmin(true);
  const queue = useReviewQueue(!!admin.data);
  if (admin.isPending || queue.isLoading) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (!admin.data) {
    return (
      <Centered>
        <Text className="text-slate-500">Platform operators only.</Text>
      </Centered>
    );
  }
  return (
    <ScrollView contentContainerClassName="gap-3 p-4 pb-16">
      {queue.data?.map((r) => <ReviewCard key={r.id} r={r} />)}
      {queue.data?.length === 0 ? <Text className="p-6 text-center text-slate-500">Queue is empty.</Text> : null}
    </ScrollView>
  );
}
