export type CounterWindow = { lengthMs: number } | { endsAt: Date };

export interface RateCount {
  count: number;
  expiresAt: Date;
}

export interface IRateCounterRepository {
  // Atomic: counts one hit, and a window that already ended starts over at 1.
  hit(key: string, window: CounterWindow): Promise<RateCount>;

  refund(key: string): Promise<void>;
}
