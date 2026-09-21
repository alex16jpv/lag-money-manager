/**
 * What the mocked suite cannot see about contacts (T-113): the partial unique
 * index, its collation, and the keyset cursor. All three live in MongoDB, not
 * in the service.
 */
import request from "supertest";

import app from "../../app";
import { connect, disconnect, dropDatabase } from "./support";

// A valid uuid v7 minted before any row here, so `_id > it` would match every one of them.
const BEFORE_EVERY_ID = "01950000-0000-7000-8000-a00000000099";

interface Session {
  token: string;
  userId: string;
}

async function register(email: string): Promise<Session> {
  const res = await request(app)
    .post("/auth/register")
    .send({ name: "Owner", email, password: "Offline!2026" });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

const as = (session: Session, req: request.Test): request.Test =>
  req.set("Authorization", `Bearer ${session.token}`);

const createContact = async (
  session: Session,
  body: Record<string, unknown>,
): Promise<request.Response> =>
  as(session, request(app).post("/contacts").send(body));

describe("contacts against mongod", () => {
  let alice: Session;
  let bob: Session;

  beforeAll(async () => {
    await connect();
    await dropDatabase();
    alice = await register("alice@contacts.test");
    bob = await register("bob@contacts.test");
  });

  afterAll(async () => {
    await disconnect();
  });

  describe("one active name per user", () => {
    it("refuses a second contact with the same name", async () => {
      expect((await createContact(alice, { name: "Ana" })).status).toBe(201);

      const again = await createContact(alice, { name: "Ana" });

      expect(again.status).toBe(409);
      expect(again.body.code).toBe("DUPLICATE");
    });

    it("folds case, because the index carries the collation", async () => {
      const res = await createContact(alice, { name: "ANA" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DUPLICATE");
    });

    it("keeps accents distinct", async () => {
      const res = await createContact(alice, { name: "Aná" });

      expect(res.status).toBe(201);
    });

    it("lets another user hold the same name", async () => {
      const res = await createContact(bob, { name: "Ana" });

      expect(res.status).toBe(201);
    });
  });

  describe("archiving frees the name", () => {
    it("takes the name again once the first is archived, and refuses the restore", async () => {
      const first = await createContact(alice, { name: "Beto" });
      expect(first.status).toBe(201);
      const firstId = first.body.id as string;

      expect(
        (await as(alice, request(app).delete(`/contacts/${firstId}`))).status,
      ).toBe(200);

      const second = await createContact(alice, { name: "Beto" });
      expect(second.status).toBe(201);

      const restored = await as(
        alice,
        request(app).post(`/contacts/${firstId}/restore`).send({}),
      );
      expect(restored.status).toBe(409);
      expect(restored.body.code).toBe("DUPLICATE");
    });

    it("restores under a new name in the same write", async () => {
      const created = await createContact(alice, { name: "Carla" });
      const id = created.body.id as string;
      await as(alice, request(app).delete(`/contacts/${id}`));
      expect((await createContact(alice, { name: "Carla" })).status).toBe(201);

      const restored = await as(
        alice,
        request(app)
          .post(`/contacts/${id}/restore`)
          .send({ name: "Carla Mesa" }),
      );

      expect(restored.status).toBe(200);
      expect(restored.body.name).toBe("Carla Mesa");
      expect(restored.body.archivedAt).toBeNull();
    });
  });

  describe("the listing", () => {
    it("hides archived contacts unless they are asked for", async () => {
      const active = await as(alice, request(app).get("/contacts?limit=100"));
      const all = await as(
        alice,
        request(app).get("/contacts?limit=100&includeArchived=true"),
      );

      expect(
        active.body.data.every((c: { archivedAt: null }) => !c.archivedAt),
      ).toBe(true);
      expect(all.body.pagination.total).toBeGreaterThan(
        active.body.pagination.total,
      );
    });

    it("walks the whole list through the cursor without repeating a row", async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: request.Response = await as(
          alice,
          request(app).get(
            `/contacts?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
          ),
        );
        expect(res.status).toBe(200);
        seen.push(...res.body.data.map((c: { id: string }) => c.id));
        cursor = res.body.pagination.nextCursor;
      } while (cursor);

      const whole = await as(alice, request(app).get("/contacts?limit=100"));
      expect(seen).toEqual(whole.body.data.map((c: { id: string }) => c.id));
      expect(new Set(seen).size).toBe(seen.length);
    });

    it("refuses a cursor that names no contact of the caller's", async () => {
      const res = await as(
        alice,
        request(app).get(`/contacts?cursor=${BEFORE_EVERY_ID}`),
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CURSOR");
    });

    it("refuses another user's row as a cursor, so it cannot act as an id oracle", async () => {
      const bobContact = await createContact(bob, { name: "Dani" });

      const res = await as(
        alice,
        request(app).get(`/contacts?cursor=${bobContact.body.id}`),
      );

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_CURSOR");
    });
  });

  describe("a client-minted id", () => {
    it("replays the user's own row instead of creating a second one", async () => {
      const id = "01a00000-0000-7000-8000-a00000000001";
      const first = await createContact(alice, { id, name: "Fran" });
      expect(first.status).toBe(201);

      const again = await createContact(alice, { id, name: "Fran again" });

      expect(again.status).toBe(200);
      expect(again.body.id).toBe(id);
      expect(again.body.name).toBe("Fran");
    });

    it("refuses another user's id with ID_TAKEN, worded so it cannot be probed", async () => {
      const id = "01a00000-0000-7000-8000-a00000000002";
      expect((await createContact(bob, { id, name: "Gabi" })).status).toBe(201);

      const res = await createContact(alice, { id, name: "Gabi" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ID_TAKEN");
      expect(res.body.message).not.toContain("Gabi");
    });
  });

  describe("clearing a field", () => {
    it("removes the email from the document instead of storing null", async () => {
      const created = await createContact(alice, {
        name: "Elsa",
        email: "elsa@example.com",
        color: "TEAL",
      });
      const id = created.body.id as string;

      const cleared = await as(
        alice,
        request(app).put(`/contacts/${id}`).send({ email: null }),
      );

      expect(cleared.status).toBe(200);
      expect(cleared.body).not.toHaveProperty("email");
      expect(cleared.body.color).toBe("TEAL");
    });
  });
});
