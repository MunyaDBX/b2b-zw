import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { z } from 'zod';
import { Button, FormField } from '@/components/ui';
import { emailRule, passwordRule } from '@/features/auth/schemas';
import { supabase } from '@/lib/supabase';

const signInSchema = z.object({
  email: emailRule,
  password: z.string().min(1, 'Enter your password'),
});

const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your name'),
    email: emailRule,
    password: passwordRule,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;

function SignInForm({ onError }: { onError: (m: string | null) => void }) {
  const { control, handleSubmit, formState } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });
  const submit = handleSubmit(async ({ email, password }) => {
    onError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) onError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  });
  return (
    <View className="gap-4">
      <FormField control={control} name="email" label="Work email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <FormField control={control} name="password" label="Password" secureTextEntry autoComplete="current-password" />
      <Link href="/forgot-password" className="self-end text-brand underline dark:text-blue-300">
        Forgot password?
      </Link>
      <Button title="Sign in" onPress={submit} loading={formState.isSubmitting} />
    </View>
  );
}

function SignUpForm({ onError, onNeedsConfirm }: { onError: (m: string | null) => void; onNeedsConfirm: (email: string) => void }) {
  const { control, handleSubmit, formState } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: '', email: '', password: '', confirm: '' },
  });
  const submit = handleSubmit(async ({ fullName, email, password }) => {
    onError(null);
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) return onError(error.message);
    // With "Confirm email" on, Supabase returns no session until the link is clicked.
    if (!data.session) onNeedsConfirm(email);
  });
  return (
    <View className="gap-4">
      <FormField control={control} name="fullName" label="Your name" autoComplete="name" />
      <FormField control={control} name="email" label="Work email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <FormField control={control} name="password" label="Password (8+ characters, a letter and a number)" secureTextEntry autoComplete="new-password" />
      <FormField control={control} name="confirm" label="Confirm password" secureTextEntry autoComplete="new-password" />
      <Button title="Create account" onPress={submit} loading={formState.isSubmitting} />
    </View>
  );
}

export default function SignIn() {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-4 p-6" keyboardShouldPersistTaps="handled">
        <Text className="text-3xl font-bold text-brand-dark dark:text-white">B2B ZW</Text>
        <Text className="text-slate-600 dark:text-slate-400">Industrial procurement, freight & trade finance.</Text>

        {confirmEmail ? (
          <View className="gap-3 rounded-2xl bg-brand-light p-4">
            <Text className="font-semibold text-brand-dark">Check your inbox</Text>
            <Text className="text-brand-dark">
              We sent a confirmation link to {confirmEmail}. Open it, then come back and sign in.
            </Text>
          </View>
        ) : null}

        {mode === 'signIn' ? <SignInForm onError={setError} /> : <SignUpForm onError={setError} onNeedsConfirm={(e) => { setConfirmEmail(e); setMode('signIn'); }} />}
        {error ? <Text className="text-danger">{error}</Text> : null}

        <Button
          variant="secondary"
          title={mode === 'signIn' ? 'New company? Create an account' : 'Have an account? Sign in'}
          onPress={() => {
            setError(null);
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
