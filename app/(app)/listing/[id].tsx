import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { FormScreen } from '@/components/FormScreen';
import { Badge, Card, Centered, Row } from '@/components/ui';
import { AuctionPanel } from '@/features/listings/panels/AuctionPanel';
import { DetailsCard } from '@/features/listings/panels/DetailsCard';
import { EscrowPanel } from '@/features/listings/panels/EscrowPanel';
import { FreightPanel } from '@/features/listings/panels/FreightPanel';
import { ContactCard, MediaGallery } from '@/features/listings/panels/MediaAndContact';
import { SealedBiddingPanel } from '@/features/listings/panels/SealedBiddingPanel';
import { VERTICALS } from '@/features/listings/verticals';
import { useListing } from '@/features/rfq/api';
import { formatMoney, timeLeft } from '@/lib/format';
import { useActiveMembership } from '@/stores/session';

const APPROVAL_TONE = { draft: 'neutral', pending_approval: 'warn', approved: 'ok', rejected: 'danger' } as const;

export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const membership = useActiveMembership();
  const listing = useListing(id);

  if (listing.isPending) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (listing.isError) {
    return (
      <Centered>
        <Text className="text-danger">{listing.error.message}</Text>
      </Centered>
    );
  }

  const l = listing.data;
  const v = VERTICALS[l.listing_type];
  const isOwner = l.company_id === membership?.companyId;
  const showSealed = v.bidding === 'sealed' && !!l.bidding_closes_at;

  return (
    <>
      <Stack.Screen options={{ title: v.label }} />
      <FormScreen>
        <MediaGallery listingId={l.id} show="photos" />
        <View className="flex-row flex-wrap gap-2">
          <Badge label={l.approval_status.replace('_', ' ')} tone={APPROVAL_TONE[l.approval_status]} />
          <Badge label={l.status} />
          {l.bidding_closes_at ? <Badge label={timeLeft(l.bidding_closes_at)} /> : null}
          {isOwner ? <Badge label="Your listing" tone="ok" /> : null}
        </View>
        <Text className="text-2xl font-bold text-slate-900 dark:text-white">{l.title}</Text>
        <Card>
          <Row label={v.priceLabel} value={formatMoney(l.budget_or_target_price, l.currency)} />
          <Row label="Payment terms" value={l.payment_terms.replace('_', ' ')} />
          <Row label="Location" value={l.delivery_location ?? '—'} />
          <Row label="Category" value={l.category} />
          {l.description ? <Text className="mt-2 text-slate-600 dark:text-slate-400">{l.description}</Text> : null}
        </Card>

        <MediaGallery listingId={l.id} show="documents" />
        <DetailsCard listingId={l.id} vertical={v} />
        {v.bidding === 'auction' ? <AuctionPanel listing={l} isOwner={isOwner} /> : null}
        {showSealed ? <SealedBiddingPanel listing={l} vertical={v} isOwner={isOwner} /> : null}
        {l.listing_type === 'freight_haulage' && l.status === 'awarded' ? <FreightPanel listing={l} isOwner={isOwner} /> : null}
        {l.status === 'awarded' ? <EscrowPanel listing={l} isOwner={isOwner} /> : null}

        <ContactCard listing={l} senderCompany={membership?.companyName ?? ''} />
      </FormScreen>
    </>
  );
}
