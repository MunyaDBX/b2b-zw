import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { z } from 'zod';
import { Button, FormField } from '@/components/ui';
import { emailRule, passwordRule } from '@/features/auth/schemas';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/stores/session';

/**
 * Code-based reset: Supabase emails a one-time code, the user types it here.
 * No deep links, so it works in Expo Go, the browser and production builds alike.
 */
const emailSchema = z.object({ email: emailRule });
const resetSchema = z
  .object({
    code: z.string().trim().regex(/^\d{6,10}$/, 'Enter the code from the email'),
    password: passwordRule,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

function RequestCode({ onSent }: { onSent: (email: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });
  const submit = handleSubmit(async ({ email }) => {
    setError(null);
    const { error: e } = await supabase.auth.resetPasswordForEmail(email);
    if (e) return setError(e.message);
    onSent(email);
  });
  return (
    <View className="gap-4">
      <Text className="text-slate-600 dark:text-slate-400">Enter your account email and we'll send you a reset code.</Text>
      <FormField control={control} name="email" label="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      {error ? <Text className="text-danger">{error}</Text> : null}
      <Button title="Send reset code" onPress={submit} loading={formState.isSubmitting} />
    </View>
  );
}

function EnterCode({ email, onResend }: { email: string; onResend: () => Promise<void> }) {
  const setRecovering = useSessionStore((s) => s.setRecovering);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: '', password: '', confirm: '' },
  });

  const submit = handleSubmit(async ({ code, password }) => {
    setError(null);
    // Verifying signs the user in; hold the guard on this screen until the password is saved.
    setRecovering(true);
    const verified = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
    if (verified.error) {
      setRecovering(false);
      return setError(verified.error.message.includes('expired') ? 'That code is wrong or has expired. Request a new one.' : verified.error.message);
    }
    const updated = await supabase.auth.updateUser({ password });
    if (updated.error) {
      await supabase.auth.signOut();
      setRecovering(false);
      return setError(updated.error.message);
    }
    setRecovering(false);
    Alert.alert('Password updated', 'You are now signed in.');
  });

  return (
    <View className="gap-4">
      <Text className="text-slate-600 dark:text-slate-400">
        We sent a code to <Text className="font-semibold">{email}</Text>. It can take a minute; check spam too.
      </Text>
      <FormField control={control} name="code" label="Reset code" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" />
      <FormField control={control} name="password" label="New password" secureTextEntry autoComplete="new-password" />
      <FormField control={control} name="confirm" label="Confirm new password" secureTextEntry autoComplete="new-password" />
      {error ? <Text className="text-danger">{error}</Text> : null}
      <Button title="Set new password" onPress={submit} loading={formState.isSubmitting} />
      <Pressable onPress={() => void onResend()} className="self-center p-2">
        <Text className="text-brand underline dark:text-blue-300">Resend code</Text>
      </Pressable>
    </View>
  );
}

export default function ForgotPassword() {
  const [email, setEmail] = useState<string | null>(null);

  const resend = async () => {
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    Alert.alert(error ? 'Could not resend' : 'Code sent', error ? error.message : `A new code is on its way to ${email}.`);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-4 p-6" keyboardShouldPersistTaps="handled">
        <Text className="text-3xl font-bold text-brand-dark dark:text-white">Reset password</Text>
        {email ? <EnterCode email={email} onResend={resend} /> : <RequestCode onSent={setEmail} />}
        <Button variant="secondary" title="Back to sign in" onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
