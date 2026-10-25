import { Camera, FileText, ImagePlus, Paperclip, X } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, Text, View } from 'react-native';
import { SectionTitle } from '@/components/ui';
import { MAX_ATTACHMENTS, formatBytes, pickDocument, pickImages, type LocalFile } from '@/lib/uploads';

/** Collects photos and documents locally; the post screen uploads them after the listing is created. */
export function AttachmentPicker({ files, onChange }: { files: LocalFile[]; onChange: (f: LocalFile[]) => void }) {
  const [busy, setBusy] = useState(false);
  const remaining = MAX_ATTACHMENTS - files.length;

  const add = async (pick: () => Promise<LocalFile[]>) => {
    if (remaining <= 0) return Alert.alert('Limit reached', `You can attach up to ${MAX_ATTACHMENTS} files.`);
    setBusy(true);
    try {
      const picked = await pick();
      if (picked.length) onChange([...files, ...picked].slice(0, MAX_ATTACHMENTS));
    } catch (e) {
      Alert.alert('Could not add file', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ActionButton = ({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy || remaining <= 0}
      onPress={onPress}
      className={`flex-1 items-center gap-1 rounded-xl border border-slate-300 bg-white py-3 active:opacity-70 dark:border-slate-600 dark:bg-slate-800 ${remaining <= 0 ? 'opacity-40' : ''}`}
    >
      {icon}
      <Text className="text-xs font-medium text-slate-700 dark:text-slate-200">{label}</Text>
    </Pressable>
  );

  const images = files.filter((f) => f.isImage);
  const docs = files.filter((f) => !f.isImage);

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <SectionTitle>Photos & documents</SectionTitle>
        <Text className="text-xs text-slate-500">
          {files.length}/{MAX_ATTACHMENTS}
        </Text>
      </View>
      <Text className="text-xs text-slate-500">Photos are resized automatically. Documents: PDF, Word or Excel up to 10 MB.</Text>
      <View className="flex-row gap-2">
        <ActionButton icon={<ImagePlus size={20} color="#0F4C81" />} label="Photos" onPress={() => void add(() => pickImages(remaining))} />
        {Platform.OS !== 'web' ? (
          <ActionButton icon={<Camera size={20} color="#0F4C81" />} label="Camera" onPress={() => void add(() => pickImages(1, 'camera'))} />
        ) : null}
        <ActionButton
          icon={<Paperclip size={20} color="#0F4C81" />}
          label="Document"
          onPress={() => void add(async () => ((f) => (f ? [f] : []))(await pickDocument()))}
        />
      </View>
      {busy ? <ActivityIndicator /> : null}

      {images.length ? (
        <View className="flex-row flex-wrap gap-2">
          {images.map((f) => (
            <View key={f.uri} className="relative">
              <Image source={{ uri: f.uri }} style={{ width: 96, height: 96, borderRadius: 12 }} accessibilityLabel={f.name} />
              <Pressable
                accessibilityLabel={`Remove ${f.name}`}
                onPress={() => onChange(files.filter((x) => x !== f))}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1"
                hitSlop={8}
              >
                <X size={14} color="white" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {docs.map((f) => (
        <View key={f.uri} className="flex-row items-center gap-2 rounded-xl bg-white p-3 dark:bg-slate-800">
          <FileText size={18} color="#0F4C81" />
          <Text className="flex-1 text-slate-800 dark:text-slate-200" numberOfLines={1}>
            {f.name}
          </Text>
          <Text className="text-xs text-slate-500">{formatBytes(f.size)}</Text>
          <Pressable accessibilityLabel={`Remove ${f.name}`} onPress={() => onChange(files.filter((x) => x !== f))} hitSlop={8}>
            <X size={16} color="#B91C1C" />
          </Pressable>
        </View>
      ))}
    </View>
  );
}
