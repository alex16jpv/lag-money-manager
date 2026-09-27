export const EMAIL_BUDGETS = {
  reset: "reset",
  security: "security",
  other: "other",
} as const;

export type EmailBudget = keyof typeof EMAIL_BUDGETS;

export function emailBudgetSlices(
  cap: number,
  resetPercent: number,
  otherPercent: number,
): Record<EmailBudget, number> {
  const reset = Math.floor((cap * resetPercent) / 100);
  const other = Math.floor((cap * otherPercent) / 100);
  return { reset, other, security: cap - reset - other };
}
