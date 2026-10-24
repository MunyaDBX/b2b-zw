import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';

type Variant = 'primary' | 'secondary' | 'danger';
const VARIANT: Record<Variant, { box: string; text: string }> = {
  primary: { box: 'bg-brand', text: 'text-white' },
  secondary: { box: 'bg-brand-light', text: 'text-brand-dark' },
  danger: { box: 'bg-danger', text: 'text-white' },
};

export function Button(props: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
}) {
  const v = VARIANT[props.variant ?? 'primary'];
  const disabled = props.disabled || props.loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      disabled={disabled}
      className={`items-center rounded-xl px-4 py-3 active:opacity-80 ${v.box} ${disabled ? 'opacity-50' : ''}`}
    >
      {props.loading ? <ActivityIndicator color="white" /> : <Text className={`font-semibold ${v.text}`}>{props.title}</Text>}
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger' }) {
  const cls = {
    neutral: 'bg-slate-100 text-slate-700',
    ok: 'bg-green-100 text-ok',
    warn: 'bg-amber-100 text-warn',
    danger: 'bg-red-100 text-danger',
  }[tone];
  return <Text className={`self-start overflow-hidden rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">{children}</View>;
}

export function FormField<T extends FieldValues>(
  props: { control: Control<T>; name: FieldPath<T>; label: string } & Omit<TextInputProps, 'value' | 'onChangeText'>,
) {
  const { control, name, label, ...input } = props;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => (
        <View className="gap-1">
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</Text>
          <TextInput
            {...input}
            value={value == null ? '' : String(value)}
            onChangeText={onChange}
            onBlur={onBlur}
            accessibilityLabel={label}
            className={`rounded-xl border bg-white px-3 py-2.5 text-base text-slate-900 dark:bg-slate-800 dark:text-white ${
              error ? 'border-danger' : 'border-slate-300 dark:border-slate-600'
            }`}
            placeholderTextColor="#94a3b8"
          />
          {error ? <Text className="text-xs text-danger">{error.message}</Text> : null}
        </View>
      )}
    />
  );
}

export function Chips<T extends string>(props: { options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {props.options.map((o) => {
        const active = o.value === props.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => props.onChange(o.value)}
            className={`rounded-full border px-3 py-1.5 ${active ? 'border-brand bg-brand' : 'border-slate-300 bg-white dark:bg-slate-800'}`}
          >
            <Text className={active ? 'text-white' : 'text-slate-700 dark:text-slate-200'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  return <View className="flex-1 items-center justify-center gap-3 bg-slate-50 p-6 dark:bg-slate-950">{children}</View>;
}

export function SwitchField<T extends FieldValues>(props: { control: Control<T>; name: FieldPath<T>; label: string }) {
  return (
    <Controller
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">{props.label}</Text>
          <Switch value={!!field.value} onValueChange={field.onChange} accessibilityLabel={props.label} />
        </View>
      )}
    />
  );
}

export function ChipsField<T extends FieldValues>(props: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: readonly { value: string; label: string }[];
  multi?: boolean;
}) {
  return (
    <Controller
      control={props.control}
      name={props.name}
      render={({ field, fieldState: { error } }) => {
        const selected: string[] = props.multi ? ((field.value as string[] | undefined) ?? []) : [String(field.value ?? '')];
        return (
          <View className="gap-1">
            <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">{props.label}</Text>
            <View className="flex-row flex-wrap gap-2">
              {props.options.map((o) => {
                const active = selected.includes(o.value);
                return (
                  <Pressable
                    key={o.value}
                    accessibilityRole={props.multi ? 'checkbox' : 'radio'}
                    accessibilityState={{ checked: active }}
                    onPress={() =>
                      field.onChange(
                        props.multi ? (active ? selected.filter((x) => x !== o.value) : [...selected, o.value]) : o.value,
                      )
                    }
                    className={`rounded-full border px-3 py-1.5 ${active ? 'border-brand bg-brand' : 'border-slate-300 bg-white dark:bg-slate-800'}`}
                  >
                    <Text className={active ? 'text-white' : 'text-slate-700 dark:text-slate-200'}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {error ? <Text className="text-xs text-danger">{error.message}</Text> : null}
          </View>
        );
      }}
    />
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text className="text-lg font-semibold text-slate-900 dark:text-white">{children}</Text>;
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4 py-1">
      <Text className="text-slate-500 dark:text-slate-400">{label}</Text>
      <Text className="flex-1 text-right font-medium text-slate-900 dark:text-white">{value}</Text>
    </View>
  );
}
