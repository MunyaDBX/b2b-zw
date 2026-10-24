import { MessageCircle } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { openWhatsAppQuote, type QuoteContext } from './templates';

interface Props extends QuoteContext {
  phone: string | null;
}

export function WhatsAppQuoteButton({ phone, ...ctx }: Props) {
  const [busy, setBusy] = useState(false);
  if (!phone) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Request quotation on WhatsApp"
      disabled={busy}
      onPress={async () => {
        setBusy(true);
        try {
          await openWhatsAppQuote(phone, ctx);
        } catch {
          Alert.alert('WhatsApp unavailable', 'Could not open WhatsApp on this device.');
        } finally {
          setBusy(false);
        }
      }}
      className="flex-row items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 active:opacity-80"
    >
      <MessageCircle size={18} color="white" />
      <Text className="font-semibold text-white">Quote via WhatsApp</Text>
    </Pressable>
  );
}
