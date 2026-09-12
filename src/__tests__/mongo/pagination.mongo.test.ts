/**
 * The edges of keyset pagination against a real mongod (T-15): what the mocked
 * suite cannot see, because the defects live in the `_id` filter the driver
 * builds and in where the page boundary actually falls.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

const LISTS = ["/accounts", "/categories", "/budgets", "/transactions"];

// A valid uuid v7 minted before any row here, so `_id > it` used to match every one of them.
const BEFORE_EVERY_ID = "01950000-0000-7000-8000-a00000000099";

interface Session {
  token: string;
  userId: string;
}

interface Page {
  data: { id: string }[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

async function register(email: string): Promise<Session> {
  const res = await request(app)
    .post("/auth/register")
    .send({ name: "Pager", email, password: "Offline!2026" });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

const get = async (session: Session, path: string): Promise<request.Response> =>
  as(session, request(app).get(path));

const page = async (session: Session, path: string): Promise<Page> => {
  const res = await get(session, path);
  expect(res.status).toBe(200);
  return res.body as Page;
};

describe("pagination edges against mongod", () => {
  let alice: Session;
  let bob: Session;
  let bobAccountId: string;

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    alice = await register("alice@pager.test");
    bob = await register("bob@pager.test");

    for (const name of ["Wallet", "Bank", "Card", "Jar"]) {
      const res = await as(
        alice,
        request(app)
          .post("/accounts")
          .send({ name, type: "CASH", balance: 100 }),
      );
      expect(res.status).toBe(201);
    }
    // Registering already seeds categories, so a second Food is the 409 the unique name index owes.
    const wallet = (await page(alice, "/accounts?limit=100")).data[0].id;
    // Written in this order on purpose: uuidv7 grows with it, so id order is not amount order.
    for (const amount of [30, 10, 40, 20]) {
      const res = await as(
        alice,
        request(app).post("/transactions").send({
          type: "EXPENSE",
          amount,
          date: "2026-09-01T12:00:00.000Z",
          fromAccountId: wallet,
        }),
      );
      expect(res.status).toBe(201);
    }
    // One category each: two global budgets of the same period overlap, which is a 400.
    const expenseCategories = (
      await page(alice, "/categories?limit=100&type=EXPENSE")
    ).data.slice(0, 2);
    expect(expenseCategories).toHaveLength(2);
    for (const [i, category] of expenseCategories.entries()) {
      const res = await as(
        alice,
        request(app)
          .post("/budgets")
          .send({
            name: `Budget ${i}`,
            type: "EXPENSE",
            color: "GRAY",
            categoryIds: [category.id],
            amount: 500,
            periodType: "MONTHLY",
          }),
      );
      expect(res.status).toBe(201);
    }

    const bobAccount = await as(
      bob,
      request(app)
        .post("/accounts")
        .send({ name: "Bob's", type: "CASH", balance: 1 }),
    );
    expect(bobAccount.status).toBe(201);
    bobAccountId = bobAccount.body.id;
  });

  afterAll(async () => {
    await dropDatabase();
    await disconnect();
  });

  describe("a cursor the server cannot place", () => {
    // A shape the query schema already refuses; here as the floor the next block builds on.
    const malformed: [string, string][] = [
      ["one that is not an id at all", "not-a-cursor"],
      ["one that sorts before every id", "0"],
      ["an empty one", ""],
      ["one sent more than once", "one&cursor=two"],
    ];

    it.each(malformed)("refuses %s, on every list", async (_label, cursor) => {
      for (const list of LISTS) {
        const res = await get(alice, `${list}?cursor=${cursor}`);
        expect([list, res.status, res.body.code]).toEqual([
          list,
          400,
          "VALIDATION",
        ]);
      }
    });

    // Only the list can tell a well-formed id names no row, and `_id > it` matched all that follow.
    it("refuses a well-formed id no row of the user's has", async () => {
      for (const list of LISTS) {
        const res = await get(alice, `${list}?cursor=${BEFORE_EVERY_ID}`);
        expect([list, res.status, res.body.code]).toEqual([
          list,
          400,
          "INVALID_CURSOR",
        ]);
      }
    });

    it("refuses another user's row as a pivot, telling nothing about it", async () => {
      const res = await get(alice, `/accounts?cursor=${bobAccountId}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CURSOR");
      // Same answer an invented id gets: the reply cannot say the row exists.
      const invented = await get(alice, `/accounts?cursor=${BEFORE_EVERY_ID}`);
      expect(res.body).toEqual(invented.body);
    });
  });

  describe("the last page", () => {
    // `hasMore` was `data.length === limit`, so an exactly full last page promised another one.
    it.each(LISTS)(
      "walks %s once per row and stops on the last one",
      async (list) => {
        const all = await page(alice, `${list}?limit=100`);
        expect(all.data.length).toBeGreaterThan(1);
        expect(all.pagination.hasMore).toBe(false);

        const seen: string[] = [];
        let requests = 0;
        let cursor: string | null = null;
        for (;;) {
          const current: Page = await page(
            alice,
            `${list}?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
          );
          requests += 1;
          seen.push(...current.data.map((row) => row.id));
          if (!current.pagination.hasMore) {
            expect(current.pagination.nextCursor).toBeNull();
            break;
          }
          expect(current.pagination.nextCursor).not.toBeNull();
          cursor = current.pagination.nextCursor;
          expect(requests).toBeLessThan(all.data.length + 1);
        }

        // One request per row: no empty page at the end, and no row twice.
        expect(requests).toBe(all.data.length);
        expect(seen).toEqual(all.data.map((row) => row.id));
      },
    );

    it("reports the total of the filtered set, not of the page", async () => {
      const first = await page(alice, "/accounts?limit=1");
      const second = await page(
        alice,
        `/accounts?limit=1&cursor=${first.pagination.nextCursor}`,
      );

      expect(first.pagination.total).toBe(4);
      expect(second.pagination.total).toBe(4);
      // A cursor page starts where the cursor is, so its offset is zero.
      expect(second.pagination.offset).toBe(0);
    });
  });

  describe("offset paging still answers as it did", () => {
    it("pages accounts by offset and knows when it is done", async () => {
      const first = await page(alice, "/accounts?limit=3");
      const last = await page(alice, "/accounts?limit=3&offset=3");

      expect(first.data).toHaveLength(3);
      expect(first.pagination).toMatchObject({ hasMore: true, offset: 0 });
      expect(last.data).toHaveLength(1);
      expect(last.pagination).toMatchObject({
        hasMore: false,
        offset: 3,
        nextCursor: null,
      });
    });

    it("answers an offset past the end with an empty page", async () => {
      const beyond = await page(alice, "/accounts?limit=3&offset=99");

      expect(beyond.data).toEqual([]);
      expect(beyond.pagination).toMatchObject({
        hasMore: false,
        nextCursor: null,
        total: 4,
      });
    });
  });

  // The four share one instant, so ordering by date is ordering by id: 30, 10, 40, 20.
  describe("ordering by amount", () => {
    const amountsOf = async (query: string): Promise<number[]> => {
      const res = await get(alice, `/transactions?${query}`);
      expect(res.status).toBe(200);
      return (res.body as { data: { amount: number }[] }).data.map(
        (t) => t.amount,
      );
    };

    it("ranks the biggest first and the smallest first on demand", async () => {
      expect(await amountsOf("sort=amount&order=desc")).toEqual([
        40, 30, 20, 10,
      ]);
      expect(await amountsOf("sort=amount&order=asc")).toEqual([
        10, 20, 30, 40,
      ]);
    });

    // The sequence a page that never looked at `sort` would answer, spelled out.
    it("is not the order they were written in", async () => {
      expect(await amountsOf("")).toEqual([20, 40, 10, 30]);
      expect(await amountsOf("order=asc")).toEqual([30, 10, 40, 20]);
    });

    it("asks for the two biggest without reading the rest", async () => {
      const res = await get(alice, "/transactions?sort=amount&limit=2");

      expect(res.status).toBe(200);
      expect(res.body.data.map((t: { amount: number }) => t.amount)).toEqual([
        40, 30,
      ]);
      // The count is of the filtered set, so the client knows it asked for a slice.
      expect(res.body.pagination.total).toBe(4);
      expect(res.body.pagination.hasMore).toBe(true);
    });

    // The cursor is a keyset over (amount, _id): a page that forgot the sort would restart.
    it("continues the same order through the cursor", async () => {
      const seen: number[] = [];
      let cursor: string | null = null;
      for (;;) {
        const current: Page = await page(
          alice,
          `/transactions?sort=amount&order=asc&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
        );
        seen.push(
          ...(current.data as unknown as { amount: number }[]).map(
            (t) => t.amount,
          ),
        );
        if (!current.pagination.hasMore) break;
        cursor = current.pagination.nextCursor;
      }

      expect(seen).toEqual([10, 20, 30, 40]);
    });

    it("refuses a field it does not order by", async () => {
      const res = await get(alice, "/transactions?sort=description");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
    });
  });

  // One request for a budget of several categories, instead of narrowing in the client.
  describe("filtering by several categories", () => {
    it("refuses categoryId and categoryIds together", async () => {
      const two = (await page(alice, "/categories?limit=100&type=EXPENSE"))
        .data;
      const res = await get(
        alice,
        `/transactions?categoryId=${two[0].id}&categoryIds=${two[0].id},${two[1].id}`,
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
    });

    it("refuses a categoryIds that is not a list of ids", async () => {
      const res = await get(alice, "/transactions?categoryIds=food,drink");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION");
    });

    it("returns the union of the categories named, and nothing else", async () => {
      const categories = (
        await page(alice, "/categories?limit=100&type=EXPENSE")
      ).data;
      expect(categories.length).toBeGreaterThanOrEqual(3);
      const [first, second, third] = categories;
      const wallet = (await page(alice, "/accounts?limit=100")).data[0].id;
      for (const [categoryId, amount] of [
        [first.id, 7],
        [second.id, 8],
        [third.id, 9],
      ] as const) {
        const res = await as(
          alice,
          request(app).post("/transactions").send({
            type: "EXPENSE",
            amount,
            date: "2026-08-10T12:00:00.000Z",
            categoryId,
            fromAccountId: wallet,
          }),
        );
        expect(res.status).toBe(201);
      }

      const window =
        "from=2026-08-01T00:00:00.000Z&to=2026-09-01T00:00:00.000Z";
      const both = await page(
        alice,
        `/transactions?categoryIds=${first.id},${second.id}&${window}&sort=amount&order=asc`,
      );

      expect(
        (both.data as unknown as { amount: number }[]).map((t) => t.amount),
      ).toEqual([7, 8]);
      expect(both.pagination.total).toBe(2);
    });
  });
});
