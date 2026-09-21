import { v7 as uuidv7 } from "uuid";

import {
  SETTLEMENT_PARTIES,
  SettlementPartyKind,
} from "../../shared/constants";
import { MAX_AMOUNT } from "../../shared/money";
import { DomainValidationError } from "../errors";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** A person, or the block of guests of one expense — a block has no other expense to net against. */
export interface SettlementCounterparty {
  kind: SettlementPartyKind;
  contactId: string | null;
  expenseId: string | null;
}

export interface SharedSettlementProps {
  id?: string;
  userId: string;
  counterparty: SettlementCounterparty;
  date: Date;
  // What came back to you, and what you handed over. One settle-up can write both halves.
  collected?: number;
  paid?: number;
  // Cash that never reached an account kept here: no movement, and what is owed falls all the same.
  outsideApp?: boolean;
  currency?: string;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class SharedSettlement {
  id: string;
  userId: string;
  counterparty: SettlementCounterparty;
  date: Date;
  collected: number;
  paid: number;
  outsideApp: boolean;
  currency?: string;
  deletedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;

  constructor(props: SharedSettlementProps) {
    this.id = props.id ?? uuidv7();
    this.userId = props.userId;
    this.counterparty = props.counterparty;
    this.date = props.date;
    this.collected = props.collected ?? 0;
    this.paid = props.paid ?? 0;
    this.outsideApp = props.outsideApp ?? false;
    this.currency = props.currency;
    this.deletedAt = props.deletedAt ?? null;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  assertValid(): void {
    if (this.collected < 0 || this.paid < 0) {
      throw new DomainValidationError(
        "A payment cannot be negative",
        "collected",
      );
    }
    if (this.collected + this.paid <= 0) {
      throw new DomainValidationError(
        "A payment has to move something: collected, paid, or both",
        "collected",
      );
    }
    if (this.collected > MAX_AMOUNT || this.paid > MAX_AMOUNT) {
      throw new DomainValidationError(
        `A payment must be at most ${MAX_AMOUNT}`,
        "collected",
      );
    }
    // The same window a movement has: a payment is money that already changed hands.
    if (this.date.getTime() > Date.now() + ONE_DAY_MS) {
      throw new DomainValidationError(
        "date cannot be more than 24 hours in the future",
        "date",
        "FUTURE_DATE",
      );
    }
    const { kind, contactId, expenseId } = this.counterparty;
    if (kind === SETTLEMENT_PARTIES.CONTACT && (!contactId || expenseId)) {
      throw new DomainValidationError(
        "A payment with a person names the contact and nothing else",
        "counterparty",
      );
    }
    if (kind === SETTLEMENT_PARTIES.GUESTS && (!expenseId || contactId)) {
      throw new DomainValidationError(
        "A payment with a block of guests names the expense it lives in",
        "counterparty",
      );
    }
  }
}
