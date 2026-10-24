import '../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthBootstrap } from '@/features/auth/useAuthBootstrap';
import { queryClient } from '@/lib/queryClient';

function Bootstrap() {
  useAuthBootstrap();
  return <Slot />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <Bootstrap />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
