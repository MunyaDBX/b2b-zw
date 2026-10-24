import { Redirect, Tabs } from 'expo-router';
import { Building2, ClipboardCheck, LayoutList, Landmark, PlusCircle, Truck } from 'lucide-react-native';
import { ActivityIndicator } from 'react-native';
import { Centered } from '@/components/ui';
import { hasRole, useActiveMembership, useSessionStore } from '@/stores/session';

const HIDDEN = ['listing/[id]', 'post/[type]', 'finance/new', 'finance/review', 'company/commute', 'onboarding'] as const;

export default function AppLayout() {
  const { session, initialized } = useSessionStore();
  const membership = useActiveMembership();

  if (!initialized) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const show = (visible: boolean) => (visible ? undefined : null);

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#0F4C81', headerTitleStyle: { fontWeight: '700' } }}>
      <Tabs.Screen
        name="feed"
        options={{
          title: membership?.companyName || 'Marketplace',
          tabBarLabel: 'Feed',
          tabBarIcon: ({ color, size }) => <LayoutList color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="post/index"
        options={{
          title: 'Post',
          href: show(hasRole(membership, 'procurement_officer', 'logistics_manager')),
          tabBarIcon: ({ color, size }) => <PlusCircle color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          href: show(hasRole(membership, 'procurement_officer', 'finance_approver')),
          tabBarIcon: ({ color, size }) => <ClipboardCheck color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Jobs',
          href: show(hasRole(membership, 'logistics_manager', 'driver')),
          tabBarIcon: ({ color, size }) => <Truck color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="finance/index"
        options={{
          title: 'Finance',
          href: show(hasRole(membership, 'finance_approver', 'procurement_officer')),
          tabBarIcon: ({ color, size }) => <Landmark color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="company/index"
        options={{ title: 'Company', href: show(!!membership), tabBarIcon: ({ color, size }) => <Building2 color={color} size={size} /> }}
      />
      {HIDDEN.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
