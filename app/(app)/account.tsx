import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Text, TextInput, View } from 'react-native';
import { z } from 'zod';
import { FormScreen } from '@/components/FormScreen';
import { Button, Card, FormField, Row, SectionTitle } from '@/components/ui';
import { emailRule, passwordRule } from '@/features/auth/schemas';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/stores/session';

const inputCls = 'rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base dark:bg-slate-800 dark:text-white';

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name'),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'International format, e.g. +263771234567')
    .optional()
    .or(z.literal('')),
});

function Profile() {
  const user = useSessionStore((s) => s.session?.user);
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; phone?: string };
  const { control, handleSubmit, formState } = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: meta.full_name ?? '', phone: meta.phone ?? '' },
  });
  const save = handleSubmit(async ({ fullName, phone }) => {
    const { error } = await supabase.auth.updateUser({ data: { full_name: fullName, phone: phone || null } });
    Alert.alert(error ? 'Could not save' : 'Profile saved', error?.message);
  });
  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>Profile</SectionTitle>
        <FormField control={control} name="fullName" label="Name" autoComplete="name" />
        <FormField control={control} name="phone" label="Mobile (optional)" keyboardType="phone-pad" placeholder="+263771234567" />
        <Button title="Save profile" variant="secondary" onPress={save} loading={formState.isSubmitting} />
      </View>
    </Card>
  );
}

const emailSchema = z.object({ email: emailRule });

function ChangeEmail() {
  const user = useSessionStore((s) => s.session?.user);
  const { control, handleSubmit, formState, reset } = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });
  const submit = handleSubmit(async ({ email }) => {
    if (email === user?.email) return Alert.alert('No change', 'That is already your email.');
    const { error } = await supabase.auth.updateUser({ email });
    if (error) return Alert.alert('Could not change email', error.message);
    reset();
    Alert.alert('Confirm the change', `We sent confirmation links to ${email}${user?.email ? ` and ${user.email}` : ''}. Your email changes once confirmed.`);
  });
  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>Email</SectionTitle>
        <Row label="Current" value={user?.email ?? '—'} />
        {user?.new_email ? <Row label="Pending" value={`${user.new_email} (awaiting confirmation)`} /> : null}
        <FormField control={control} name="email" label="New email" autoCapitalize="none" keyboardType="email-address" />
        <Button title="Change email" variant="secondary" onPress={submit} loading={formState.isSubmitting} />
      </View>
    </Card>
  );
}

const passwordSchema = z
  .object({ current: z.string().min(1, 'Enter your current password'), password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
  .refine((v) => v.password !== v.current, { path: ['password'], message: 'Choose a different password' });

function ChangePassword() {
  const email = useSessionStore((s) => s.session?.user.email);
  const { control, handleSubmit, formState, reset } = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: '', password: '', confirm: '' },
  });
  const submit = handleSubmit(async ({ current, password }) => {
    if (!email) return;
    // Re-check the current password so an unlocked phone isn't enough to take over the account.
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) return Alert.alert('Current password is wrong');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return Alert.alert('Could not change password', error.message);
    reset();
    Alert.alert('Password changed');
  });
  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>Password</SectionTitle>
        <FormField control={control} name="current" label="Current password" secureTextEntry autoComplete="current-password" />
        <FormField control={control} name="password" label="New password" secureTextEntry autoComplete="new-password" />
        <FormField control={control} name="confirm" label="Confirm new password" secureTextEntry autoComplete="new-password" />
        <Button title="Change password" variant="secondary" onPress={submit} loading={formState.isSubmitting} />
      </View>
    </Card>
  );
}

function DangerZone() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const deleteAccount = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('delete_my_account');
    if (error) {
      setBusy(false);
      return Alert.alert('Could not delete account', error.message);
    }
    qc.clear();
    await supabase.auth.signOut({ scope: 'local' });
  };

  return (
    <Card>
      <View className="gap-3">
        <SectionTitle>Sessions & account</SectionTitle>
        <Button title="Sign out" variant="secondary" onPress={() => void supabase.auth.signOut({ scope: 'local' })} />
        <Button
          title="Sign out on all devices"
          variant="secondary"
          onPress={() =>
            Alert.alert('Sign out everywhere?', 'Every phone and browser signed in to this account will be signed out.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out all', onPress: () => void supabase.auth.signOut({ scope: 'global' }) },
            ])
          }
        />
        <View className="mt-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Text className="font-semibold text-danger">Delete account</Text>
          <Text className="text-sm text-slate-600 dark:text-slate-400">
            Permanently deletes your login. Companies where you are the only member are deleted too. If you are the only admin of a
            company with other members, make someone else admin first. Type DELETE to confirm.
          </Text>
          <TextInput value={confirm} onChangeText={setConfirm} autoCapitalize="characters" placeholder="DELETE" className={inputCls} />
          <Button title="Delete my account" variant="danger" disabled={confirm !== 'DELETE'} loading={busy} onPress={() => void deleteAccount()} />
        </View>
      </View>
    </Card>
  );
}

export default function Account() {
  return (
    <FormScreen className="gap-4 p-4 pb-24">
      <Profile />
      <ChangeEmail />
      <ChangePassword />
      <DangerZone />
    </FormScreen>
  );
}
