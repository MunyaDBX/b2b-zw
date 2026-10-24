import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { ChipsField, FormField, SwitchField } from '@/components/ui';
import type { Field } from './verticals';

/** Renders one vertical-config field into the matching form control under `details.<name>`. */
export function DynamicField<T extends FieldValues>({ control, field }: { control: Control<T>; field: Field }) {
  const name = `details.${field.name}` as FieldPath<T>;
  switch (field.kind) {
    case 'text':
      return <FormField control={control} name={name} label={field.label} placeholder={field.placeholder} />;
    case 'number':
      return (
        <FormField
          control={control}
          name={name}
          label={field.suffix ? `${field.label} (${field.suffix})` : field.label}
          keyboardType={field.integer ? 'number-pad' : 'decimal-pad'}
        />
      );
    case 'date':
      return <FormField control={control} name={name} label={field.label} placeholder="YYYY-MM-DD" />;
    case 'boolean':
      return <SwitchField control={control} name={name} label={field.label} />;
    case 'select':
      return <ChipsField control={control} name={name} label={field.label} options={field.options} />;
    case 'multi':
      return <ChipsField control={control} name={name} label={field.label} options={field.options} multi />;
  }
}
