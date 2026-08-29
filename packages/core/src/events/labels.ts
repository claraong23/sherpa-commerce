import type { AgentEventType } from '../schemas'

/**
 * Human-readable event labels.
 *
 * Deliberately in its own module with no imports beyond types: the
 * visualization is a client component, and importing these from `bus.ts` would
 * pull the event bus, the data store and `node:crypto` into the browser bundle.
 *
 * Every label is an observable system state. None of them narrate model
 * reasoning — there is no chain-of-thought to show, by design.
 */
export const EVENT_LABELS: Record<AgentEventType, string> = {
  SESSION_STARTED: 'Session started',
  INTENT_RECEIVED: 'Customer request received',
  INTENT_PARSED: 'Requirements structured',
  CUSTOMER_CONSTRAINTS_SET: 'Hard constraints set',
  CLARIFICATION_REQUESTED: 'Clarification requested',
  TAP_REQUEST_SIGNED: 'Request signed (Ed25519)',
  TAP_AGENT_VERIFIED: 'Agent identity verified',
  AGENT_SIGNATURE_INVALID: 'Signature verification failed',
  RFO_CREATED: 'Request for offers created',
  RFO_SENT: 'Request delivered to merchant agent',
  MERCHANT_INVENTORY_CHECKED: 'Inventory checked',
  MERCHANT_RULES_APPLIED: 'Merchant rules applied',
  MERCHANT_OFFER_CREATED: 'Offer constructed',
  MERCHANT_OFFER_SEALED: 'Offer sealed',
  MERCHANT_NO_OFFER: 'No valid offer available',
  ALL_OFFERS_RECEIVED: 'All offers received',
  OFFER_HARD_FILTERED: 'Hard constraints evaluated',
  OFFER_FACTS_VERIFIED: 'Offer facts verified',
  OFFER_SCORED: 'Customer utility scored',
  RECOMMENDATION_CREATED: 'Recommendation created',
  COUNTER_REQUESTED: 'Counteroffer requested',
  COUNTER_OFFER_CREATED: 'Counteroffer returned',
  COUNTER_DECLINED: 'Counteroffer declined',
  OFFER_LOCKED: 'Offer locked',
  OFFER_LOCK_FAILED: 'Offer lock failed',
  PAYMENT_INSTRUCTION_CREATED: 'Payment Instruction created',
  PASSKEY_CHALLENGE_ISSUED: 'Passkey challenge issued',
  PASSKEY_CONFIRMED: 'Passkey confirmed',
  PAYMENT_INSTRUCTION_CHECK: 'Payment Instruction control checked',
  PAYMENT_INSTRUCTION_DECLINED: 'Payment Instruction declined',
  VISA_AUTH_STARTED: 'Visa Acceptance authorization started',
  VISA_AUTH_APPROVED: 'Authorization approved',
  VISA_AUTH_DECLINED: 'Authorization declined',
  ORDER_CREATED: 'Order created',
  RECEIPT_SENT: 'Receipt issued',
  DEMO_FAULT_INJECTED: 'Demo fault injected',
}

export function eventLabel(t: AgentEventType): string {
  return EVENT_LABELS[t] ?? t
}
