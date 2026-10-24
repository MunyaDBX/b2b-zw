import { zodResolver } from '@hookform/resolvers/zod';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { Alert, ScrollView, Text } from 'react-native';
import { z } from 'zod';
import { Button, ChipsField, FormField, SectionTitle } from '@/components/ui';
import { DynamicField } from '@/features/listings/DynamicField';
import { useCreateListing } from '@/features/listings/api';
import { VERTICALS, detailDefaults, detailsSchema, type Vertical } from '@/features/listings/verticals';
import { E164 } from '@/features/rfq/schemas';
import { useSessionStore } from '@/stores/session';
import type { ListingType } from '@/types/models';

const CURRENCIES = [
  { value: 'USD', label: 'USD' },
  { value: 'ZWG', label: 'ZWG' },
  { value: 'ZAR', label: 'ZAR' },
];
const TERMS = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'net_15', label: 'Net 15' },
  { value: 'net_30', label: 'Net 30' },
  { value: 'net_60', label: 'Net 60' },
  { value: 'escrow', label: 'Escrow' },
];

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const optionalMoney = z.preprocess(blank, z.coerce.number().positive('Must be greater than 0').optional());

function listingSchema(v: Vertical) {
  const days = z.coerce.number().int().min(1, 'Minimum 1 day').max(60, 'Maximum 60 days');
  return z.object({
    title: z.string().trim().min(3, 'At least 3 characters').max(200),
    category: z.string().trim().min(2, 'Category is required'),
    description: z.string().trim().max(5000).optional(),
    price: optionalMoney,
    reserve: v.bidding === 'auction' ? optionalMoney : z.any().optional(),
    currency: z.enum(['USD', 'ZWG', 'ZAR']),
    paymentTerms: z.enum(['immediate', 'net_15', 'net_30', 'net_60', 'escrow']),
    deliveryLocation: z.string().trim().max(300).optional(),
    biddingDays: v.biddingRequired ? z.preprocess(blank, days) : z.preprocess(blank, days.optional()),
    whatsapp: z.string().trim().regex(E164, 'Use international format, e.g. +263771234567').optional().or(z.literal('')),
    details: detailsSchema(v),
  });
}
type FormValues = z.output<ReturnType<typeof listingSchema>> & { details: Record<string, unknown> };

function ListingForm({ vertical }: { vertical: Vertical }) {
  const companyId = useSessionStore((s) => s.activeCompanyId);
  const create = useCreateListing(companyId);
  const schema = useMemo(() => listingSchema(vertical), [vertical]);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FormValues>,
    defaultValues: {
      title: '',
      category: vertical.label,
      currency: 'USD',
      paymentTerms: vertical.postedBy === 'buyer' ? 'net_30' : 'immediate',
      biddingDays: vertical.biddingRequired ? 7 : undefined,
      whatsapp: '',
      details: detailDefaults(vertical),
    },
  });

  const submit = handleSubmit((v) => {
    const closes = v.biddingDays ? new Date(Date.now() + Number(v.biddingDays) * 86_400_000).toISOString() : undefined;
    create.mutate(
      {
        listing: {
          listing_type: vertical.type,
          title: v.title,
          category: v.category,
          description: v.description || undefined,
          budget_or_target_price: v.price as number | undefined,
          reserve_price: vertical.bidding === 'auction' ? (v.reserve as number | undefined) : undefined,
          currency: v.currency,
          payment_terms: v.paymentTerms,
          delivery_location: v.deliveryLocation || undefined,
          whatsapp_business_number: v.whatsapp || undefined,
          bidding_closes_at: vertical.bidding === 'none' ? undefined : closes,
        },
        details: vertical.fields.length ? v.details : undefined,
      },
      {
        onSuccess: ({ id, approval_status }) => {
          Alert.alert(
            approval_status === 'approved' ? 'Published' : 'Sent for approval',
            approval_status === 'approved' ? 'Your listing is live.' : 'It goes live once all approvers sign off.',
          );
          router.replace({ pathname: '/listing/[id]', params: { id } });
        },
        onError: (e) => Alert.alert('Could not create listing', e.message),
      },
    );
  });

  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-16" keyboardShouldPersistTaps="handled">
      <Text className="text-slate-600 dark:text-slate-400">{vertical.blurb}</Text>
      <FormField control={control} name="title" label="Title" placeholder="Short, specific headline" />
      <FormField control={control} name="category" label="Category" />
      <FormField control={control} name="description" label="Description / specification" multiline numberOfLines={4} />

      {vertical.fields.length ? <SectionTitle>{vertical.label} details</SectionTitle> : null}
      {vertical.fields.map((f) => (
        <DynamicField key={f.name} control={control} field={f} />
      ))}

      <SectionTitle>Commercials</SectionTitle>
      <FormField control={control} name="price" label={`${vertical.priceLabel} (optional)`} keyboardType="decimal-pad" />
      {vertical.bidding === 'auction' ? (
        <FormField control={control} name="reserve" label="Reserve price (hidden from bidders)" keyboardType="decimal-pad" />
      ) : null}
      <ChipsField control={control} name="currency" label="Currency" options={CURRENCIES} />
      <ChipsField control={control} name="paymentTerms" label="Payment terms" options={TERMS} />
      <FormField control={control} name="deliveryLocation" label="Location" placeholder="Msasa, Harare" />
      {vertical.bidding !== 'none' ? (
        <FormField
          control={control}
          name="biddingDays"
          label={vertical.biddingRequired ? 'Bidding open (days)' : 'Bidding open (days, optional)'}
          keyboardType="number-pad"
        />
      ) : null}
      <FormField control={control} name="whatsapp" label="WhatsApp for enquiries (optional)" placeholder="+263771234567" keyboardType="phone-pad" />
      <Text className="text-xs text-slate-500">
        Listings above your company's approval threshold, on escrow terms, or disposing of assets need sign-off before going live.
      </Text>
      <Button title="Submit" onPress={submit} loading={create.isPending} />
    </ScrollView>
  );
}

export default function PostListing() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const vertical = VERTICALS[type as ListingType] as Vertical | undefined;
  if (!vertical) return <Redirect href="/post" />;
  return (
    <>
      <Stack.Screen options={{ title: vertical.label }} />
      <ListingForm key={vertical.type} vertical={vertical} />
    </>
  );
}
