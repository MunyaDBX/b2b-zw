import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView, Text, View } from 'react-native';
import { z } from 'zod';
import { Button, Chips, FormField } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { CompanyType } from '@/types/models';

const schema = z.object({
  name: z.string().trim().min(2, 'Company name is required'),
  registration: z.string().trim().min(3, 'Registration number is required'),
  vat: z.string().trim().optional(),
  city: z.string().trim().optional(),
  type: z.enum(['buyer', 'supplier', 'logistics_provider', 'hybrid']),
});
type Values = z.infer<typeof schema>;

const TYPES: { value: CompanyType; label: string }[] = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'logistics_provider', label: 'Logistics' },
  { value: 'hybrid', label: 'Hybrid' },
];

export default function Onboarding() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', registration: '', vat: '', city: 'Harare', type: 'hybrid' },
  });

  const submit = handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await supabase.rpc('create_company', {
      p_name: v.name,
      p_registration_number: v.registration,
      p_type: v.type,
      p_vat_tax_id: v.vat || undefined,
      p_head_office_city: v.city || undefined,
    });
    if (e) return setError(e.message);
    await qc.invalidateQueries({ queryKey: ['memberships'] });
    router.replace('/feed');
  });

  return (
    <ScrollView contentContainerClassName="gap-4 p-4">
      <Text className="text-slate-600 dark:text-slate-400">You'll be the company admin and can invite colleagues afterwards.</Text>
      <FormField control={control} name="name" label="Registered company name" />
      <FormField control={control} name="registration" label="Company registration number" autoCapitalize="characters" />
      <FormField control={control} name="vat" label="VAT / ZIMRA BP number (optional)" />
      <FormField control={control} name="city" label="Head office city" />
      <View className="gap-1">
        <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">Company type</Text>
        <Controller control={control} name="type" render={({ field }) => <Chips options={TYPES} value={field.value} onChange={field.onChange} />} />
      </View>
      {error ? <Text className="text-danger">{error}</Text> : null}
      <Button title="Create company" onPress={submit} loading={formState.isSubmitting} />
    </ScrollView>
  );
}
