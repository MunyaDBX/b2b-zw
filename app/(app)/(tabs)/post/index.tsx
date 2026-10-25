import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Badge } from '@/components/ui';
import { VERTICAL_LIST } from '@/features/listings/verticals';

export default function PostPicker() {
  return (
    <ScrollView contentContainerClassName="gap-3 p-4 pb-12" className="bg-slate-50 dark:bg-slate-950">
      <Text className="text-slate-600 dark:text-slate-400">What would you like to post?</Text>
      {VERTICAL_LIST.map((v) => (
        <Pressable
          key={v.type}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/post/[type]', params: { type: v.type } })}
          className="flex-row items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 active:opacity-80 dark:border-slate-700 dark:bg-slate-900"
        >
          <View className="flex-1 gap-1">
            <Text className="text-base font-semibold text-slate-900 dark:text-white">{v.label}</Text>
            <Text className="text-slate-600 dark:text-slate-400">{v.blurb}</Text>
            <Badge
              label={v.bidding === 'sealed' ? 'Sealed bids' : v.bidding === 'auction' ? 'Open auction' : 'Enquiries & WhatsApp'}
            />
          </View>
          <ChevronRight size={20} color="#94a3b8" />
        </Pressable>
      ))}
    </ScrollView>
  );
}
