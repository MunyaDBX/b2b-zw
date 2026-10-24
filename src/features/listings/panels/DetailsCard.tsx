import { ActivityIndicator, View } from 'react-native';
import { Card, Row, SectionTitle } from '@/components/ui';
import { useListingDetails } from '../api';
import { displayValue, type Vertical } from '../verticals';

export function DetailsCard({ listingId, vertical }: { listingId: string; vertical: Vertical }) {
  const details = useListingDetails(listingId);
  if (vertical.fields.length === 0) return null;
  return (
    <Card>
      <View className="gap-1">
        <SectionTitle>{vertical.label} details</SectionTitle>
        {details.isPending ? (
          <ActivityIndicator />
        ) : (
          vertical.fields.map((f) => <Row key={f.name} label={f.label} value={displayValue(f, details.data?.[f.name])} />)
        )}
      </View>
    </Card>
  );
}
