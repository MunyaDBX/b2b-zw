import '../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Centered } from '@/components/ui';
import { useAuthBootstrap } from '@/features/auth/useAuthBootstrap';
import { queryClient } from '@/lib/queryClient';
import { useSessionStore } from '@/stores/session';

function RootNavigator() {
  useAuthBootstrap();
  const { initialized, session, recovering } = useSessionStore();
  const signedIn = !!session && !recovering;

  if (!initialized) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  // Guards redirect automatically: signed-out users land on sign-in, signed-in users never see it.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)/sign-in" />
        <Stack.Screen name="(auth)/forgot-password" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <RootNavigator />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
