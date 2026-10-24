import { zodResolver } from '@hookform/resolvers/zod';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { z } from 'zod';
import { Button, FormField } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useSessionStore } from '@/stores/session';

const schema = z.object({
  email: z.string().trim().email('Enter a valid work email'),
  password: z.string().min(8, 'At least 8 characters'),
});
type Values = z.infer<typeof schema>;

export default function SignIn() {
  const session = useSessionStore((s) => s.session);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const { control, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (session) return <Redirect href="/feed" />;

  const submit = handleSubmit(async ({ email, password }) => {
    setError(null);
    const { error: e } =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (e) setError(e.message);
  });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <View className="gap-4">
        <Text className="text-3xl font-bold text-brand-dark dark:text-white">B2B ZW</Text>
        <Text className="text-slate-600 dark:text-slate-400">Industrial procurement, freight & trade finance.</Text>
        <FormField control={control} name="email" label="Work email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <FormField control={control} name="password" label="Password" secureTextEntry autoComplete="password" />
        {error ? <Text className="text-danger">{error}</Text> : null}
        <Button title={mode === 'signIn' ? 'Sign in' : 'Create account'} onPress={submit} loading={formState.isSubmitting} />
        <Button
          variant="secondary"
          title={mode === 'signIn' ? 'New company? Create an account' : 'Have an account? Sign in'}
          onPress={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
