import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { Centered } from '@/components/ui';
import { useSessionStore } from '@/stores/session';

export default function Entry() {
  const { initialized, session } = useSessionStore();
  if (!initialized) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  return <Redirect href={session ? '/feed' : '/sign-in'} />;
}
