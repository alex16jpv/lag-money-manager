/**
 * What `GET /budgets` leaves out, judged by the query itself (T-161): expired
 * CUSTOM windows and budgets that do not exist yet in the reference window.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase, TEST_CAPTCHA } from "./support";

const SEPTEMBER = "2026-09-15T12:00:00.000Z";
const OCTOBER = "2026-10-15T12:00:00.000Z";

interface Page {
  data: { id: string; expired: boolean }[];
  pagination: {
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

interface Lister {
  token: string;
  categories: string[];
  ids: Record<string, string>;
}

// Registration leaves the profile in America/Bogota (UTC-5), where every window below is cut.
async function register(email: string): Promise<Lister> {
  const registered = await request(app).post("/auth/register").send({
    captcha: TEST_CAPTCHA,
    name: "Lister",
    email,
    password: "Offline!2026",
  });
  expect(registered.status).toBe(201);
  const token = registered.body.accessToken as string;
  const categories = await request(app)
    .get("/categories?limit=100&type=EXPENSE")
    .set("Authorization", `Bearer ${token}`);
  expect(categories.body.data.length).toBeGreaterThanOrEqual(4);
  return {
    token,
    categories: (categories.body.data as { id: string }[]).map((c) => c.id),
    ids: {},
  };
}

async function page(lister: Lister, query: string): Promise<Page> {
  const res = await request(app)
    .get(`/budgets?${query}`)
    .set("Authorization", `Bearer ${lister.token}`);
  expect(res.status).toBe(200);
  return res.body as Page;
}

async function create(
  lister: Lister,
  key: string,
  body: Record<string, unknown>,
): Promise<{ createdAt: string }> {
  const res = await request(app)
    .post("/budgets")
    .set("Authorization", `Bearer ${lister.token}`)
    .send({ name: key, type: "EXPENSE", color: "GRAY", amount: 500, ...body });
  expect(res.status).toBe(201);
  lister.ids[key] = res.body.id;
  return res.body;
}

const listed = async (lister: Lister, query: string): Promise<string[]> =>
  (await page(lister, `${query}&limit=100`)).data.map((view) => view.id);

beforeAll(async () => {
  await connect();
  await dropDatabase();
});

afterAll(async () => {
  await dropDatabase();
  await disconnect();
});

describe("budgets the listing leaves out, against mongod", () => {
  let lister: Lister;

  beforeAll(async () => {
    lister = await register("lister@budgets.test");
    const [trips, food, rent] = lister.categories;

    // Written first on purpose: uuidv7 grows with creation, so they head the `_id` order.
    for (const month of ["01", "02", "03"]) {
      const end = String(Number(month) + 1).padStart(2, "0");
      await create(lister, `ended-${month}`, {
        categoryIds: [trips],
        periodType: "CUSTOM",
        periodStartDate: `2026-${month}-01T00:00:00.000Z`,
        periodEndDate: `2026-${end}-01T00:00:00.000Z`,
      });
    }
    await create(lister, "starts-october", {
      categoryIds: [rent],
      periodType: "MONTHLY",
      effectiveFrom: "2026-10-05T00:00:00.000Z",
    });
    await create(lister, "monthly", {
      categoryIds: [food],
      periodType: "MONTHLY",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    await create(lister, "september-trip", {
      categoryIds: [trips],
      periodType: "CUSTOM",
      periodStartDate: "2026-09-01T00:00:00.000Z",
      periodEndDate: "2026-10-01T00:00:00.000Z",
    });
  });

  it("fills a page with live budgets even when ended ones come first", async () => {
    const { ids } = lister;
    const first = await page(lister, `reference=${SEPTEMBER}&limit=2`);

    expect(first.data.map((view) => view.id)).toEqual([
      ids.monthly,
      ids["september-trip"],
    ]);
    expect(first.pagination).toMatchObject({
      total: 2,
      hasMore: false,
      nextCursor: null,
    });
  });

  it("walks the live budgets once each, with no empty page", async () => {
    const { ids } = lister;
    const seen: string[] = [];
    let cursor: string | null = null;
    let requests = 0;
    do {
      const current: Page = await page(
        lister,
        `reference=${SEPTEMBER}&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
      );
      requests += 1;
      expect(current.data).toHaveLength(1);
      expect(current.pagination.total).toBe(2);
      seen.push(current.data[0].id);
      cursor = current.pagination.nextCursor;
    } while (cursor && requests < 10);

    expect(requests).toBe(2);
    expect(seen).toEqual([ids.monthly, ids["september-trip"]]);
  });

  it("counts the ended ones only when asked for, backdated windows included", async () => {
    const { ids } = lister;
    const all = await page(
      lister,
      `reference=${SEPTEMBER}&includeExpired=true&limit=100`,
    );

    expect(all.data.map((view) => [view.id, view.expired])).toEqual([
      [ids["ended-01"], true],
      [ids["ended-02"], true],
      [ids["ended-03"], true],
      [ids.monthly, false],
      [ids["september-trip"], false],
    ]);
    expect(all.pagination.total).toBe(5);
  });

  it("lists a budget from the window its effectiveFrom falls in, and not before", async () => {
    const { ids } = lister;
    const october = await page(lister, `reference=${OCTOBER}&limit=100`);

    expect(october.data.map((view) => view.id)).toEqual([
      ids["starts-october"],
      ids.monthly,
    ]);
    expect(october.pagination.total).toBe(2);
  });

  it("keeps the archive filter in the same count", async () => {
    const { ids } = lister;
    const archived = await request(app)
      .delete(`/budgets/${ids.monthly}`)
      .set("Authorization", `Bearer ${lister.token}`);
    expect(archived.status).toBe(200);

    const active = await page(lister, `reference=${SEPTEMBER}&limit=100`);
    const withArchived = await page(
      lister,
      `reference=${SEPTEMBER}&includeArchived=true&limit=100`,
    );

    expect(active.data.map((view) => view.id)).toEqual([ids["september-trip"]]);
    expect(active.pagination.total).toBe(1);
    expect(withArchived.data.map((view) => view.id)).toEqual([
      ids.monthly,
      ids["september-trip"],
    ]);
    expect(withArchived.pagination.total).toBe(2);
  });
});

describe("the edges of the reference window, against mongod", () => {
  let lister: Lister;
  let createdAt: string;

  beforeAll(async () => {
    lister = await register("edges@budgets.test");
    const [late, exact, trip, plain] = lister.categories;

    // Sunday 22:00 in Bogota but already Monday in UTC: it belongs to the week of the 14th.
    await create(lister, "sunday-night", {
      categoryIds: [late],
      periodType: "WEEKLY",
      effectiveFrom: "2026-09-21T03:00:00.000Z",
    });
    // Monday 00:00 in Bogota, the very end of the week of the 14th.
    await create(lister, "next-monday", {
      categoryIds: [exact],
      periodType: "WEEKLY",
      effectiveFrom: "2026-09-21T05:00:00.000Z",
    });
    await create(lister, "trip", {
      categoryIds: [trip],
      periodType: "CUSTOM",
      periodStartDate: "2026-09-01T00:00:00.000Z",
      periodEndDate: "2026-09-20T00:00:00.000Z",
    });
    ({ createdAt } = await create(lister, "no-floor-given", {
      categoryIds: [plain],
      periodType: "MONTHLY",
    }));
  });

  it("cuts a recurring window in the user's zone, and its end is already outside it", async () => {
    const { ids } = lister;
    const week = await listed(lister, `reference=${SEPTEMBER}`);

    expect(week).toContain(ids["sunday-night"]);
    expect(week).not.toContain(ids["next-monday"]);
    expect(await listed(lister, "reference=2026-09-22T12:00:00.000Z")).toEqual(
      expect.arrayContaining([ids["sunday-night"], ids["next-monday"]]),
    );
  });

  it("expires a CUSTOM window at the instant it ends, not a millisecond before", async () => {
    const { ids } = lister;

    expect(
      await listed(lister, "reference=2026-09-19T23:59:59.999Z"),
    ).toContain(ids.trip);
    expect(
      await listed(lister, "reference=2026-09-20T00:00:00.000Z"),
    ).not.toContain(ids.trip);
  });

  it("takes createdAt as the floor when no effectiveFrom was given", async () => {
    const { ids } = lister;

    expect(
      await listed(lister, "reference=2020-06-15T12:00:00.000Z"),
    ).not.toContain(ids["no-floor-given"]);
    expect(await listed(lister, `reference=${createdAt}`)).toContain(
      ids["no-floor-given"],
    );
  });
});
