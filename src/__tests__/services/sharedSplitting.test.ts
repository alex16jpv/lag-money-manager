import { sharesByParticipant } from "../../app/services/sharedSplitting";
import { SHARE_PARTIES } from "../../shared/constants";

const share = (
  contactId: string | null,
  amount: number,
): { party: string; contactId: string | null; amount: number } => ({
  party: contactId === null ? SHARE_PARTIES.USER : SHARE_PARTIES.CONTACT,
  contactId,
  amount,
});

describe("sharesByParticipant", () => {
  it("adds what each person is down for in cents, so cents do not drift [T-157]", () => {
    const totals = sharesByParticipant([
      { split: { shares: [share(null, 0.1), share("k1", 0.2)] } },
      { split: { shares: [share(null, 0.2), share("k1", 0.1)] } },
    ] as never);

    expect(totals.get(null)).toBe(0.3);
    expect(totals.get("k1")).toBe(0.3);
  });

  it("leaves a block of guests out", () => {
    const totals = sharesByParticipant([
      {
        split: {
          shares: [
            share(null, 10),
            { party: SHARE_PARTIES.GUESTS, contactId: null, amount: 5 },
          ],
        },
      },
    ] as never);

    expect([...totals]).toEqual([[null, 10]]);
  });
});
