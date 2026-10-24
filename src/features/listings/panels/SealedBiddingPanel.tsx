import { zodResolver } from '@hookform/resolvers/zod';
import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Text, TextInput, View } from 'react-native';
import { Badge, Button, Card, FormField, SectionTitle } from '@/components/ui';
import { useIssueInvoice } from '@/features/finance/api';
import { useAwardProposal, useBidCount, useProposals, useSubmitProposal } from '@/features/rfq/api';
import { proposalSchema, type ProposalInput, type ProposalValues } from '@/features/rfq/schemas';
import { formatMoney } from '@/lib/format';
import { hasRole, useActiveMembership, useSessionStore } from '@/stores/session';
import type { ListingRow, ProposalRow } from '@/types/models';
import type { Vertical } from '../verticals';

function BidForm({ listing, vertical, existing }: { listing: ListingRow; vertical: Vertical; existing: ProposalRow | undefined }) {
  const { activeCompanyId, session } = useSessionStore();
  const submit = useSubmitProposal(listing.id, activeCompanyId, session?.user.id);
  const { control, handleSubmit } = useForm<ProposalInput, unknown, ProposalValues>({
    resolver: zodResolver(proposalSchema),
    defaultValues: existing
      ? { bidAmount: existing.bid_amount, deliveryDays: existing.delivery_timeline_days, notes: existing.notes ?? '' }
      : { notes: '' },
  });
  const onSubmit = handleSubmit((v) =>
    submit.mutate(v, {
      onSuccess: () => Alert.alert('Sealed bid submitted', 'You can revise it until bidding closes.'),
      onError: (e) => Alert.alert('Bid rejected', e.message),
    }),
  );

  return (
    <Card>
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <Lock size={16} color="#0F4C81" />
          <SectionTitle>{existing ? 'Revise your sealed bid' : 'Submit a sealed bid'}</SectionTitle>
        </View>
        <FormField control={control} name="bidAmount" label={`${vertical.bidLabel} (${listing.currency})`} keyboardType="decimal-pad" />
        <FormField control={control} name="deliveryDays" label="Lead time (days)" keyboardType="number-pad" />
        <FormField control={control} name="notes" label="Notes / exclusions" multiline />
        <Button title={existing ? 'Update bid' : 'Submit bid'} onPress={onSubmit} loading={submit.isPending} />
      </View>
    </Card>
  );
}

function IssueInvoice({ listingId, proposal }: { listingId: string; proposal: ProposalRow }) {
  const [number, setNumber] = useState('');
  const issue = useIssueInvoice(listingId);
  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>You won — raise the tax invoice</SectionTitle>
        <Text className="text-slate-600 dark:text-slate-400">
          {formatMoney(proposal.bid_amount, proposal.currency)} + 15% VAT. Escrow terms open an escrow automatically.
        </Text>
        <TextInput
          value={number}
          onChangeText={setNumber}
          placeholder="Invoice number, e.g. INV-2026-001"
          accessibilityLabel="Invoice number"
          className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base dark:bg-slate-800 dark:text-white"
        />
        <Button
          title="Issue invoice"
          disabled={number.trim().length < 2}
          loading={issue.isPending}
          onPress={() =>
            issue.mutate(
              { proposalId: proposal.id, invoiceNumber: number.trim() },
              {
                onSuccess: () => Alert.alert('Invoice issued', 'The buyer has been invoiced.'),
                onError: (e) => Alert.alert('Could not issue invoice', e.message),
              },
            )
          }
        />
      </View>
    </Card>
  );
}

function BuyerView({ listing }: { listing: ListingRow }) {
  const membership = useActiveMembership();
  const sealed = !!listing.bidding_closes_at && new Date(listing.bidding_closes_at) > new Date();
  const count = useBidCount(listing.id);
  const proposals = useProposals(listing.id);
  const award = useAwardProposal(listing.id);
  const canAward = hasRole(membership, 'procurement_officer', 'logistics_manager') && listing.status === 'open';

  if (sealed) {
    return (
      <Card>
        <View className="flex-row items-center gap-2">
          <Lock size={16} color="#B45309" />
          <Text className="flex-1 text-slate-800 dark:text-slate-200">
            {count.data ?? 0} sealed bid(s). Amounts are revealed when bidding closes.
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <View className="gap-3">
      <SectionTitle>Proposals (lowest first)</SectionTitle>
      {proposals.data?.map((p, i) => (
        <Card key={p.id}>
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-slate-900 dark:text-white">{formatMoney(p.bid_amount, p.currency)}</Text>
            {p.is_winning_bid ? <Badge label="Awarded" tone="ok" /> : i === 0 && p.status === 'submitted' ? <Badge label="Lowest" /> : null}
          </View>
          <Text className="text-slate-600 dark:text-slate-400">{p.delivery_timeline_days} days lead time</Text>
          {p.notes ? <Text className="mt-1 text-slate-600 dark:text-slate-400">{p.notes}</Text> : null}
          {canAward && p.status === 'submitted' ? (
            <View className="mt-3">
              <Button
                title="Award"
                loading={award.isPending && award.variables === p.id}
                onPress={() =>
                  Alert.alert('Award this proposal?', 'All other bidders will be marked unsuccessful.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Award', onPress: () => award.mutate(p.id, { onError: (e) => Alert.alert('Award failed', e.message) }) },
                  ])
                }
              />
            </View>
          ) : null}
        </Card>
      ))}
      {proposals.data?.length === 0 ? <Text className="text-slate-500">No bids were received.</Text> : null}
    </View>
  );
}

export function SealedBiddingPanel({ listing, vertical, isOwner }: { listing: ListingRow; vertical: Vertical; isOwner: boolean }) {
  const membership = useActiveMembership();
  const proposals = useProposals(listing.id);
  if (isOwner) return <BuyerView listing={listing} />;

  const open =
    listing.status === 'open' && listing.approval_status === 'approved' && !!listing.bidding_closes_at && new Date(listing.bidding_closes_at) > new Date();
  const mine = proposals.data?.find((p) => p.vendor_company_id === membership?.companyId);

  return (
    <View className="gap-3">
      {open && hasRole(membership, 'procurement_officer', 'logistics_manager') ? (
        <BidForm listing={listing} vertical={vertical} existing={mine} />
      ) : null}
      {mine && !open ? (
        <Card>
          <View className="flex-row items-center justify-between">
            <Text className="text-slate-800 dark:text-slate-200">Your bid: {formatMoney(mine.bid_amount, mine.currency)}</Text>
            <Badge label={mine.status} tone={mine.status === 'won' ? 'ok' : mine.status === 'lost' ? 'danger' : 'neutral'} />
          </View>
        </Card>
      ) : null}
      {mine?.status === 'won' && hasRole(membership, 'finance_approver') ? <IssueInvoice listingId={listing.id} proposal={mine} /> : null}
    </View>
  );
}
