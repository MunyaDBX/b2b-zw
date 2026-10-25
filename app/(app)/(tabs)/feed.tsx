import { FlashList } from '@shopify/flash-list';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Badge, Button, Card, Centered, Chips } from '@/components/ui';
import { useListingFeed } from '@/features/rfq/api';
import { LISTING_TYPE_LABEL, formatMoney, timeLeft } from '@/lib/format';
import { useSessionStore } from '@/stores/session';
import type { ListingRow, ListingType } from '@/types/models';

type Filter = ListingType | 'all';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...Object.entries(LISTING_TYPE_LABEL).map(([value, label]) => ({ value: value as ListingType, label })),
];

function ListingCard({ item }: { item: ListingRow }) {
  return (
    <Link href={{ pathname: '/listing/[id]', params: { id: item.id } }} asChild>
      <Pressable className="px-4 py-2">
        <Card>
          <View className="flex-row items-center justify-between">
            <Badge label={LISTING_TYPE_LABEL[item.listing_type] ?? item.listing_type} />
            <Text className="text-xs text-slate-500">{timeLeft(item.bidding_closes_at)}</Text>
          </View>
          <Text className="mt-2 text-base font-semibold text-slate-900 dark:text-white" numberOfLines={2}>
            {item.title}
          </Text>
          <View className="mt-1 flex-row justify-between">
            <Text className="text-slate-600 dark:text-slate-400">{item.delivery_location ?? item.category}</Text>
            <Text className="font-semibold text-brand dark:text-blue-300">{formatMoney(item.budget_or_target_price, item.currency)}</Text>
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}

export default function Feed() {
  const { memberships, membershipsLoaded } = useSessionStore();
  const [filter, setFilter] = useState<Filter>('all');
  const feed = useListingFeed(filter === 'all' ? null : filter);

  if (membershipsLoaded && memberships.length === 0) {
    return (
      <Centered>
        <Text className="text-center text-xl font-semibold text-slate-900 dark:text-white">Welcome to B2B ZW</Text>
        <Text className="text-center text-slate-600 dark:text-slate-400">
          Set up your company to post and bid. If a colleague's company already uses B2B ZW, ask their admin to add you instead.
        </Text>
        <Button title="Set up your company" onPress={() => router.push('/onboarding')} />
        <Button title="Account settings" variant="secondary" onPress={() => router.push('/account')} />
      </Centered>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="max-h-14 grow-0" contentContainerClassName="items-center px-4 py-2">
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
      </ScrollView>
      {feed.isPending ? (
        <Centered>
          <ActivityIndicator />
        </Centered>
      ) : feed.isError ? (
        <Centered>
          <Text className="text-danger">{feed.error.message}</Text>
          <Button title="Retry" onPress={() => void feed.refetch()} />
        </Centered>
      ) : (
        <FlashList
          data={feed.data}
          keyExtractor={(l) => l.id}
          renderItem={({ item }) => <ListingCard item={item} />}
          refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />}
          ListEmptyComponent={<Text className="p-8 text-center text-slate-500">No open listings yet.</Text>}
        />
      )}
    </View>
  );
}
