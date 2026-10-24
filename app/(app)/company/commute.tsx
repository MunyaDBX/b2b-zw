import { zodResolver } from '@hookform/resolvers/zod';
import { Bus } from 'lucide-react-native';
import { useForm } from 'react-hook-form';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { z } from 'zod';
import { Button, Card, FormField, SectionTitle } from '@/components/ui';
import { useAddCommuteRoute, useCommuteRoutes, useToggleRoute } from '@/features/company/api';
import { useSessionStore } from '@/stores/session';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

const schema = z.object({
  name: z.string().trim().min(2, 'Route name is required'),
  seats: z.coerce.number().int().min(1, 'At least 1 seat').max(120),
  stops: z.string().refine((s) => split(s).length >= 2, 'Enter at least two stops, comma-separated'),
  times: z.string().refine((s) => split(s).length > 0 && split(s).every((t) => HHMM.test(t)), 'Use 24h times like 06:30, 17:15'),
});
type Input = z.input<typeof schema>;
type Values = z.output<typeof schema>;

export default function Commute() {
  const companyId = useSessionStore((s) => s.activeCompanyId);
  const routes = useCommuteRoutes(companyId);
  const add = useAddCommuteRoute(companyId);
  const toggle = useToggleRoute(companyId);
  const { control, handleSubmit, reset } = useForm<Input, unknown, Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', stops: '', times: '' },
  });

  const submit = handleSubmit((v) =>
    add.mutate(
      { name: v.name, seats: v.seats, stops: split(v.stops), times: split(v.times) },
      { onSuccess: () => reset(), onError: (e) => Alert.alert('Could not save route', e.message) },
    ),
  );

  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-16" keyboardShouldPersistTaps="handled">
      {routes.data?.map((r) => {
        const stops = Array.isArray(r.stops) ? (r.stops as { name?: string }[]).map((s) => s.name).filter(Boolean) : [];
        return (
          <Card key={r.id}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Bus size={18} color="#0F4C81" />
                <Text className="font-semibold text-slate-900 dark:text-white">{r.route_name}</Text>
              </View>
              <Switch value={r.active} onValueChange={(active) => toggle.mutate({ id: r.id, active })} accessibilityLabel="Route active" />
            </View>
            <Text className="mt-1 text-slate-600 dark:text-slate-400">{stops.join(' → ')}</Text>
            <Text className="text-slate-600 dark:text-slate-400">
              {r.seats} seats · departs {r.departure_times.map((t) => t.slice(0, 5)).join(', ')}
            </Text>
          </Card>
        );
      })}
      <Card>
        <View className="gap-3">
          <SectionTitle>New shuttle route</SectionTitle>
          <FormField control={control} name="name" label="Route name" placeholder="Chitungwiza → Msasa plant" />
          <FormField control={control} name="stops" label="Stops (comma-separated)" placeholder="Chitungwiza, Makoni, Msasa" />
          <FormField control={control} name="times" label="Departure times" placeholder="05:30, 14:00" />
          <FormField control={control} name="seats" label="Seats" keyboardType="number-pad" />
          <Button title="Add route" onPress={submit} loading={add.isPending} />
        </View>
      </Card>
    </ScrollView>
  );
}
