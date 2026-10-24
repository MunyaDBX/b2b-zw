import { CheckCircle2, Circle, FileText } from 'lucide-react-native';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Button, Card, SectionTitle } from '@/components/ui';
import { useMembers } from '@/features/company/api';
import { NEXT_STATUS, STATUS_STEPS, useConfirmDelivery, useUpdateDispatch } from '@/features/freight/api';
import { attachmentUrl, pickAndUpload } from '@/lib/uploads';
import { hasRole, useActiveMembership, useSessionStore } from '@/stores/session';
import type { FreightStatus, ListingRow } from '@/types/models';
import { useListingDetails } from '../api';

const STATUS_LABEL: Record<FreightStatus, string> = {
  posted: 'Posted',
  assigned: 'Carrier assigned',
  loaded: 'Loaded',
  in_transit: 'In transit',
  delivered: 'Delivered (ePoD)',
  cancelled: 'Cancelled',
};

export function FreightPanel({ listing, isOwner }: { listing: ListingRow; isOwner: boolean }) {
  const membership = useActiveMembership();
  const userId = useSessionStore((s) => s.session?.user.id);
  const details = useListingDetails(listing.id);
  const update = useUpdateDispatch(listing.id);
  const confirm = useConfirmDelivery(listing.id);

  const d = details.data as
    | { dispatch_status: FreightStatus; carrier_company_id: string | null; driver_user_id: string | null; proof_of_delivery_attachment_id: string | null }
    | null
    | undefined;
  const isCarrier = !!d?.carrier_company_id && d.carrier_company_id === membership?.companyId && hasRole(membership, 'logistics_manager');
  const isDriver = !!d?.driver_user_id && d.driver_user_id === userId;
  const members = useMembers(isCarrier ? (membership?.companyId ?? null) : null);
  if (!d) return null;

  const status = d.dispatch_status;
  const next = NEXT_STATUS[status];
  const reached = STATUS_STEPS.indexOf(status);

  const uploadPod = async () => {
    if (!membership || !userId) return;
    try {
      const att = await pickAndUpload({ companyId: membership.companyId, userId });
      if (!att) return;
      confirm.mutate(att.id, {
        onSuccess: () => Alert.alert('Delivered', 'Proof of delivery recorded. Escrow release has been queued.'),
        onError: (e) => Alert.alert('Could not confirm delivery', e.message),
      });
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : String(e));
    }
  };

  const drivers = members.data?.filter((m) => m.role === 'driver') ?? [];

  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>Dispatch</SectionTitle>
        {status === 'cancelled' ? (
          <Text className="text-danger">This job was cancelled.</Text>
        ) : (
          STATUS_STEPS.map((s, i) => (
            <View key={s} className="flex-row items-center gap-2">
              {i <= reached ? <CheckCircle2 size={18} color="#15803D" /> : <Circle size={18} color="#94a3b8" />}
              <Text className={i <= reached ? 'font-medium text-slate-900 dark:text-white' : 'text-slate-400'}>{STATUS_LABEL[s]}</Text>
            </View>
          ))
        )}

        {isCarrier && status === 'assigned' ? (
          <View className="gap-2">
            <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">Assign driver</Text>
            {drivers.length === 0 ? <Text className="text-slate-500">Add a driver under Company first.</Text> : null}
            <View className="flex-row flex-wrap gap-2">
              {drivers.map((m) => (
                <Pressable
                  key={m.user_id}
                  onPress={() => update.mutate({ driverId: m.user_id }, { onError: (e) => Alert.alert('Could not assign', e.message) })}
                  className={`rounded-full border px-3 py-1.5 ${d.driver_user_id === m.user_id ? 'border-brand bg-brand' : 'border-slate-300'}`}
                >
                  <Text className={d.driver_user_id === m.user_id ? 'text-white' : 'text-slate-700 dark:text-slate-200'}>{m.email}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {(isCarrier || isDriver) && next ? (
          <Button
            title={`Mark ${STATUS_LABEL[next].toLowerCase()}`}
            loading={update.isPending}
            onPress={() => update.mutate({ status: next }, { onError: (e) => Alert.alert('Update failed', e.message) })}
          />
        ) : null}
        {(isCarrier || isDriver) && (status === 'loaded' || status === 'in_transit') ? (
          <Button title="Upload ePoD & confirm delivery" variant="secondary" loading={confirm.isPending} onPress={() => void uploadPod()} />
        ) : null}
        {isOwner && (status === 'posted' || status === 'assigned') && hasRole(membership, 'logistics_manager') ? (
          <Button
            title="Cancel job"
            variant="danger"
            onPress={() =>
              Alert.alert('Cancel this job?', undefined, [
                { text: 'Keep', style: 'cancel' },
                { text: 'Cancel job', style: 'destructive', onPress: () => update.mutate({ status: 'cancelled' }) },
              ])
            }
          />
        ) : null}
        {d.proof_of_delivery_attachment_id ? (
          <Pressable
            className="flex-row items-center gap-2"
            onPress={async () => {
              try {
                await Linking.openURL(await attachmentUrl(d.proof_of_delivery_attachment_id!));
              } catch (e) {
                Alert.alert('Cannot open document', e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <FileText size={18} color="#0F4C81" />
            <Text className="text-brand underline">View proof of delivery</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}
