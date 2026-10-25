import { useQuery } from '@tanstack/react-query';
import { FileText, Mail, MapPin, Phone } from 'lucide-react-native';
import { Alert, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Card, SectionTitle } from '@/components/ui';
import { buildQuoteMessage } from '@/features/whatsapp/templates';
import { WhatsAppQuoteButton } from '@/features/whatsapp/WhatsAppQuoteButton';
import { supabase, unwrap } from '@/lib/supabase';
import { BUCKET, formatBytes } from '@/lib/uploads';
import type { ListingRow } from '@/types/models';

interface SignedAttachment {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number | null;
  url: string | null;
}

function useListingAttachments(listingId: string) {
  return useQuery({
    queryKey: ['listings', listingId, 'attachments'],
    staleTime: 5 * 60_000, // signed URLs last 1 hour
    queryFn: async (): Promise<SignedAttachment[]> => {
      const rows = unwrap(
        await supabase
          .from('attachments')
          .select('id, file_name, mime_type, size_bytes, storage_path')
          .eq('listing_id', listingId)
          .order('sort_order'),
      );
      if (!rows.length) return [];
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 3600);
      return rows.map((r, i) => ({ ...r, url: data?.[i]?.signedUrl ?? null }));
    },
  });
}

const open = (url: string) => Linking.openURL(url).catch(() => Alert.alert('Could not open', url));

/** `photos` renders the image strip (top of the page); `documents` the file list (below the description). */
export function MediaGallery({ listingId, show }: { listingId: string; show: 'photos' | 'documents' }) {
  const q = useListingAttachments(listingId);
  const files = q.data ?? [];
  const images = show === 'photos' ? files.filter((f) => f.mime_type.startsWith('image/') && f.url) : [];
  const docs = show === 'documents' ? files.filter((f) => !f.mime_type.startsWith('image/')) : [];
  if (!images.length && !docs.length) return null;

  return (
    <View className="gap-3">
      {docs.length ? <SectionTitle>Documents</SectionTitle> : null}
      {images.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {images.map((f) => (
            <Pressable key={f.id} onPress={() => void open(f.url!)} accessibilityLabel={`Open ${f.file_name}`}>
              <Image source={{ uri: f.url! }} style={{ width: 240, height: 180, borderRadius: 16 }} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {docs.map((f) => (
        <Pressable
          key={f.id}
          disabled={!f.url}
          onPress={() => void open(f.url!)}
          className="flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
        >
          <FileText size={18} color="#0F4C81" />
          <Text className="flex-1 text-brand underline dark:text-blue-300" numberOfLines={1}>
            {f.file_name}
          </Text>
          {f.size_bytes ? <Text className="text-xs text-slate-500">{formatBytes(f.size_bytes)}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

function ContactRow({ icon, label, value, onPress }: { icon: React.ReactNode; label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={`${label}: ${value}`} className="flex-row items-center gap-3 py-2 active:opacity-60">
      {icon}
      <View className="flex-1">
        <Text className="text-xs text-slate-500">{label}</Text>
        <Text className="text-brand dark:text-blue-300">{value}</Text>
      </View>
    </Pressable>
  );
}

/** Enquiry options: WhatsApp quote, call, email (pre-filled), and directions. */
export function ContactCard({ listing, senderCompany }: { listing: ListingRow; senderCompany: string }) {
  const hasAny = listing.whatsapp_business_number || listing.contact_phone || listing.contact_email || listing.contact_address;
  if (!hasAny) return null;
  const subject = `Enquiry: ${listing.title}`;
  const body = buildQuoteMessage({ listing, senderCompany }).replace(/\*/g, '');

  return (
    <Card>
      <View className="gap-1">
        <SectionTitle>Contact{listing.contact_person ? ` · ${listing.contact_person}` : ''}</SectionTitle>
        {listing.contact_phone ? (
          <ContactRow icon={<Phone size={18} color="#0F4C81" />} label="Call" value={listing.contact_phone} onPress={() => void open(`tel:${listing.contact_phone}`)} />
        ) : null}
        {listing.contact_email ? (
          <ContactRow
            icon={<Mail size={18} color="#0F4C81" />}
            label="Email"
            value={listing.contact_email}
            onPress={() => void open(`mailto:${listing.contact_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)}
          />
        ) : null}
        {listing.contact_address ? (
          <ContactRow
            icon={<MapPin size={18} color="#0F4C81" />}
            label="Address (tap for directions)"
            value={listing.contact_address}
            onPress={() => void open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listing.contact_address!)}`)}
          />
        ) : null}
        <View className="mt-2">
          <WhatsAppQuoteButton phone={listing.whatsapp_business_number} listing={listing} senderCompany={senderCompany} />
        </View>
      </View>
    </Card>
  );
}
