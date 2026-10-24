import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Badge, Button, Card, Chips, Row } from '@/components/ui';
import { FINANCE_TONE, useInvoices, useIsPlatformAdmin, useTradeFinance } from '@/features/finance/api';
import { formatMoney } from '@/lib/format';
import { hasRole, useActiveMembership } from '@/stores/session';

type Tab = 'invoices' | 'factoring';
const TABS = [
  { value: 'invoices', label: 'Invoices & escrow' },
  { value: 'factoring', label: 'Invoice factoring' },
] as const;

function Invoices({ companyId }: { companyId: string }) {
  const q = useInvoices(companyId);
  if (q.isPending) return <ActivityIndicator />;
  if (!q.data?.invoices.length) return <Text className="p-6 text-center text-slate-500">No invoices yet.</Text>;
  const escrowFor = new Map(q.data.escrows.map((e) => [e.invoice_id, e]));
  return (
    <View className="gap-3">
      {q.data.invoices.map((inv) => {
        const incoming = inv.issuer_company_id === companyId;
        const escrow = escrowFor.get(inv.id);
        return (
          <Card key={inv.id}>
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-slate-900 dark:text-white">{inv.invoice_number}</Text>
              <Badge label={incoming ? 'Receivable' : 'Payable'} tone={incoming ? 'ok' : 'warn'} />
            </View>
            <Row label="Subtotal" value={formatMoney(inv.subtotal, inv.currency)} />
            <Row label={`VAT ${inv.vat_rate}%`} value={formatMoney(inv.vat_amount, inv.currency)} />
            <Row label="Total" value={formatMoney(inv.total, inv.currency)} />
            <Row label="Due" value={inv.due_date ?? '—'} />
            <Row label="Status" value={inv.status} />
            {escrow ? <Row label="Escrow" value={escrow.status.replace('_', ' ')} /> : null}
          </Card>
        );
      })}
    </View>
  );
}

function Factoring({ companyId, canRequest }: { companyId: string; canRequest: boolean }) {
  const q = useTradeFinance(companyId);
  return (
    <View className="gap-3">
      {canRequest ? <Button title="Request invoice financing" onPress={() => router.push('/finance/new')} /> : null}
      {q.isPending ? <ActivityIndicator /> : null}
      {q.data?.map((r) => (
        <Card key={r.id}>
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-slate-900 dark:text-white">{r.purchase_order_ref}</Text>
            <Badge label={r.status.replace('_', ' ')} tone={FINANCE_TONE[r.status]} />
          </View>
          <Row label="Debtor" value={r.debtor_company_name} />
          <Row label="Invoice" value={formatMoney(r.invoice_amount, r.currency)} />
          <Row label="Advance requested" value={`${r.advance_requested_percentage}%`} />
          {r.approved_advance != null ? <Row label="Approved advance" value={formatMoney(r.approved_advance, r.currency)} /> : null}
          {r.discount_rate_pct != null ? <Row label="Discount rate" value={`${r.discount_rate_pct}%`} /> : null}
          {r.reviewer_note ? <Text className="mt-1 text-slate-600 dark:text-slate-400">{r.reviewer_note}</Text> : null}
        </Card>
      ))}
      {q.data?.length === 0 ? <Text className="p-6 text-center text-slate-500">No financing requests.</Text> : null}
    </View>
  );
}

export default function Finance() {
  const membership = useActiveMembership();
  const [tab, setTab] = useState<Tab>('invoices');
  const platform = useIsPlatformAdmin(true);
  if (!membership) return null;
  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-16" className="bg-slate-50 dark:bg-slate-950">
      {platform.data ? <Button variant="secondary" title="Operator review queue" onPress={() => router.push('/finance/review')} /> : null}
      <Chips options={TABS} value={tab} onChange={setTab} />
      {tab === 'invoices' ? (
        <Invoices companyId={membership.companyId} />
      ) : (
        <Factoring companyId={membership.companyId} canRequest={hasRole(membership, 'finance_approver')} />
      )}
    </ScrollView>
  );
}
