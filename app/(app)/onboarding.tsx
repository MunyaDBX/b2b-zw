import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Text, View } from 'react-native';
import { z } from 'zod';
import { FormScreen } from '@/components/FormScreen';
import { Button, Chips, FormField, SwitchField } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { CompanyType } from '@/types/models';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Company name is required'),
    notRegistered: z.boolean(),
    registration: z.string().trim(),
    vat: z.string().trim().optional(),
    city: z.string().trim().optional(),
    type: z.enum(['buyer', 'supplier', 'logistics_provider', 'hybrid']),
  })
  .refine((v) => v.notRegistered || v.registration.length >= 3, {
    path: ['registration'],
    message: 'Enter the registration number, or tick "Not registered"',
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
  const { control, handleSubmit, formState, watch } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', notRegistered: false, registration: '', vat: '', city: 'Harare', type: 'hybrid' },
  });
  const notRegistered = watch('notRegistered');

  const submit = handleSubmit(async (v) => {
    setError(null);
    const { data: companyId, error: e } = await supabase.rpc('create_company', {
      p_name: v.name,
      // Blank asks the server to assign an UNREG-YYYY-XXXXXX reference.
      p_registration_number: v.notRegistered ? '' : v.registration,
      p_type: v.type,
      p_vat_tax_id: v.vat || undefined,
      p_head_office_city: v.city || undefined,
    });
    if (e) {
      return setError(
        e.message.includes('companies_registration_number_key')
          ? 'A company with this registration number already exists. Ask its admin to add you instead.'
          : e.message,
      );
    }
    if (v.notRegistered && companyId) {
      const { data } = await supabase.from('companies').select('registration_number').eq('id', companyId).single();
      if (data) Alert.alert('Company created', `Your platform reference is ${data.registration_number}. You can add a registration number later.`);
    }
    await qc.invalidateQueries({ queryKey: ['memberships'] });
    router.replace('/feed');
  });

  return (
    <FormScreen>
      <Text className="text-slate-600 dark:text-slate-400">You'll be the company admin and can invite colleagues afterwards.</Text>
      <FormField control={control} name="name" label="Company / trading name" />
      {notRegistered ? (
        <View className="rounded-xl bg-brand-light p-3">
          <Text className="text-brand-dark">
            We'll assign a platform reference (e.g. UNREG-2026-7F3A9C). Unregistered businesses can trade but show as "Unregistered" to
            buyers.
          </Text>
        </View>
      ) : (
        <FormField control={control} name="registration" label="Company registration number" autoCapitalize="characters" />
      )}
      <SwitchField control={control} name="notRegistered" label="Not registered (informal business)" />
      <FormField control={control} name="vat" label="VAT / ZIMRA BP number (optional)" />
      <FormField control={control} name="city" label="Head office city" />
      <View className="gap-1">
        <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">Company type</Text>
        <Controller control={control} name="type" render={({ field }) => <Chips options={TYPES} value={field.value} onChange={field.onChange} />} />
      </View>
      {error ? <Text className="text-danger">{error}</Text> : null}
      <Button title="Create company" onPress={submit} loading={formState.isSubmitting} />
    </FormScreen>
  );
}
