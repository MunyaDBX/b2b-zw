import { Tabs } from 'expo-router';
import { Building2, ClipboardCheck, LayoutList, Landmark, PlusCircle, Truck } from 'lucide-react-native';
import { hasRole, useActiveMembership } from '@/stores/session';

export default function TabsLayout() {
  const membership = useActiveMembership();

  // Hide tabs the role can't use without making the route unreachable
  // (href: null would block navigation to it entirely).
  const show = (visible: boolean) => (visible ? {} : { tabBarItemStyle: { display: 'none' as const } });

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
          ...show(hasRole(membership, 'procurement_officer', 'logistics_manager')),
          tabBarIcon: ({ color, size }) => <PlusCircle color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          ...show(hasRole(membership, 'procurement_officer', 'finance_approver')),
          tabBarIcon: ({ color, size }) => <ClipboardCheck color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Jobs',
          ...show(hasRole(membership, 'logistics_manager', 'driver')),
          tabBarIcon: ({ color, size }) => <Truck color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="finance/index"
        options={{
          title: 'Finance',
          ...show(hasRole(membership, 'finance_approver', 'procurement_officer')),
          tabBarIcon: ({ color, size }) => <Landmark color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="company/index"
        options={{ title: 'Company', tabBarIcon: ({ color, size }) => <Building2 color={color} size={size} /> }}
      />
    </Tabs>
  );
}
