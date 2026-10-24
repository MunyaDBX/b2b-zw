/**
 * Payment rail abstraction. Swap ManualTransferProvider for a real gateway
 * (e.g. Paynow, a bank's corporate API) without touching the settlement worker.
 */
export interface EscrowRef {
  id: string;
  amount: number;
  currency: string;
  payer_company_id: string;
  payee_company_id: string;
}

export interface PaymentProvider {
  /** Ask the payer to fund escrow. Returns the provider's collection reference. */
  requestFunding(escrow: EscrowRef): Promise<{ reference: string }>;
  /** Pay the escrowed amount out to the payee. Must be idempotent on escrow.id. */
  payout(escrow: EscrowRef): Promise<{ reference: string }>;
}

/**
 * Default rail: funds move by bank EFT handled by platform finance ops.
 * Funding is confirmed via the signed webhook (sent by ops tooling or the bank);
 * payouts return a deterministic reference that ops reconcile against.
 */
export class ManualTransferProvider implements PaymentProvider {
  async requestFunding(escrow: EscrowRef) {
    return { reference: `EFT-IN-${escrow.id.slice(0, 8).toUpperCase()}` };
  }
  async payout(escrow: EscrowRef) {
    return { reference: `EFT-OUT-${escrow.id.slice(0, 8).toUpperCase()}` };
  }
}

export function providerFromEnv(): PaymentProvider {
  const name = Deno.env.get('PAYMENT_PROVIDER') ?? 'manual';
  switch (name) {
    case 'manual':
      return new ManualTransferProvider();
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${name}`);
  }
}
