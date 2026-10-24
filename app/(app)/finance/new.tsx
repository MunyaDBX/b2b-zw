import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { FileText } from 'lucide-react-native';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Button, ChipsField, FormField } from '@/components/ui';
import { tradeFinanceSchema, useCreateTradeFinance, type TradeFinanceInput, type TradeFinanceValues } from '@/features/finance/api';
import { pickAndUpload, type UploadedAttachment } from '@/lib/uploads';
import { useSessionStore } from '@/stores/session';

const CURRENCIES = [
  { value: 'USD', label: 'USD' },
  { value: 'ZWG', label: 'ZWG' },
  { value: 'ZAR', label: 'ZAR' },
];

export default function NewTradeFinance() {
  const { activeCompanyId, session } = useSessionStore();
  const create = useCreateTradeFinance(activeCompanyId, session?.user.id);
  const [doc, setDoc] = useState<UploadedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const { control, handleSubmit } = useForm<TradeFinanceInput, unknown, TradeFinanceValues>({
    resolver: zodResolver(tradeFinanceSchema),
    defaultValues: { poRef: '', debtor: '', currency: 'USD', advancePct: 80, dueDate: '' },
  });

  const upload = async () => {
    if (!activeCompanyId || !session) return;
    setUploading(true);
    try {
      const att = await pickAndUpload({ companyId: activeCompanyId, userId: session.user.id });
      if (att) setDoc(att);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const submit = handleSubmit((v) => {
    if (!doc) {
      Alert.alert('Invoice required', 'Attach the signed invoice or purchase order.');
      return;
    }
    create.mutate(
      { ...v, attachmentId: doc.id },
      {
        onSuccess: () => {
          Alert.alert('Submitted', 'Our credit team will review your request.');
          router.back();
        },
        onError: (e) => Alert.alert('Could not submit', e.message),
      },
    );
  });

  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-16" keyboardShouldPersistTaps="handled">
      <Text className="text-slate-600 dark:text-slate-400">
        Get up to 95% of an unpaid Net-30/60 invoice advanced now. The advance is settled when your debtor pays.
      </Text>
      <FormField control={control} name="poRef" label="PO / invoice reference" />
      <FormField control={control} name="debtor" label="Debtor company" placeholder="Who owes you" />
      <FormField control={control} name="amount" label="Invoice amount" keyboardType="decimal-pad" />
      <ChipsField control={control} name="currency" label="Currency" options={CURRENCIES} />
      <FormField control={control} name="advancePct" label="Advance requested (%)" keyboardType="decimal-pad" />
      <FormField control={control} name="dueDate" label="Invoice due date" placeholder="YYYY-MM-DD" />
      <View className="gap-2">
        <Button variant="secondary" title={doc ? 'Replace document' : 'Attach invoice (PDF/photo)'} onPress={() => void upload()} loading={uploading} />
        {doc ? (
          <View className="flex-row items-center gap-2">
            <FileText size={16} color="#0F4C81" />
            <Text className="text-slate-700 dark:text-slate-300">{doc.fileName}</Text>
          </View>
        ) : null}
      </View>
      <Button title="Submit for review" onPress={submit} loading={create.isPending} />
    </ScrollView>
  );
}
