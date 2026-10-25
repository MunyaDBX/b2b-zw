import { Stack } from 'expo-router';

// Tabs live in (tabs); detail and form screens push on top of them.
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerTitleStyle: { fontWeight: '700' }, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="listing/[id]" options={{ title: 'Listing' }} />
      <Stack.Screen name="post/[type]" options={{ title: 'New listing' }} />
      <Stack.Screen name="finance/new" options={{ title: 'Invoice financing' }} />
      <Stack.Screen name="finance/review" options={{ title: 'Operator review' }} />
      <Stack.Screen name="company/commute" options={{ title: 'Commute routes' }} />
      <Stack.Screen name="onboarding" options={{ title: 'Set up your company' }} />
    </Stack>
  );
}
