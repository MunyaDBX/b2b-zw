import { FlashList } from '@shopify/flash-list';
import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Badge, Card, Centered } from '@/components/ui';
import { useMyJobs, type Job } from '@/features/freight/api';
import { useSessionStore } from '@/stores/session';

const TONE = { posted: 'neutral', assigned: 'warn', loaded: 'warn', in_transit: 'warn', delivered: 'ok', cancelled: 'danger' } as const;

function JobCard({ job }: { job: Job }) {
  return (
    <Link href={{ pathname: '/listing/[id]', params: { id: job.listing_id } }} asChild>
      <Pressable className="px-4 py-2">
        <Card>
          <View className="flex-row items-center justify-between">
            <Badge label={job.dispatch_status.replace('_', ' ')} tone={TONE[job.dispatch_status]} />
            <Text className="text-xs text-slate-500">
              {job.cargo_weight_tonnes} t · {job.required_truck_type.replace('_', ' ')}
            </Text>
          </View>
          <Text className="mt-2 text-base font-semibold text-slate-900 dark:text-white">{job.listing?.title ?? 'Freight job'}</Text>
          <Text className="text-slate-600 dark:text-slate-400">
            {job.origin_address} → {job.destination_address}
          </Text>
        </Card>
      </Pressable>
    </Link>
  );
}

export default function Jobs() {
  const { activeCompanyId, session } = useSessionStore();
  const jobs = useMyJobs(activeCompanyId, session?.user.id);
  if (jobs.isPending) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <FlashList
        data={jobs.data ?? []}
        keyExtractor={(j) => j.id}
        renderItem={({ item }) => <JobCard job={item} />}
        onRefresh={() => void jobs.refetch()}
        refreshing={jobs.isRefetching}
        ListEmptyComponent={<Text className="p-8 text-center text-slate-500">No dispatches assigned to you.</Text>}
      />
    </View>
  );
}
