/**
 * What the mocked suite cannot see about the theme in the profile (T-212):
 * the document as Mongo keeps it, read back through the repository, on both
 * update paths of PUT /users/:id.
 */
import request from "supertest";

import app from "../../app";
import { UserModel } from "../../infrastructure/models/UserModel";
import {
  connect,
  disconnect,
  dropDatabase,
  SignedInUser,
  signedInUser,
} from "./support";

const PASSWORD = "Password123!";

const put = (session: SignedInUser, body: object): request.Test =>
  request(app)
    .put(`/users/${session.user.id}`)
    .set("Authorization", `Bearer ${session.accessToken}`)
    .send(body);

const profile = (session: SignedInUser): request.Test =>
  request(app)
    .get(`/users/${session.user.id}`)
    .set("Authorization", `Bearer ${session.accessToken}`);

describe("The theme in the profile [T-212]", () => {
  beforeAll(async () => {
    await connect();
    await dropDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });

  it("reads null for a document that never had one", async () => {
    const session = await signedInUser({
      name: "Ana",
      email: "ana@theme.test",
      password: PASSWORD,
    });
    await UserModel.updateOne(
      { _id: session.user.id },
      { $unset: { theme: "" } },
    );

    const res = await profile(session).expect(200);

    expect(res.body.theme).toBeNull();
  });

  it("keeps a theme sent whole, replacing the last, and leaves the rest alone", async () => {
    const session = await signedInUser({
      name: "Bea",
      email: "bea@theme.test",
      password: PASSWORD,
      locale: "es",
    });

    await put(session, { theme: { palette: "tinta", mode: "dark" } }).expect(
      200,
    );
    await put(session, { theme: { palette: "brisa", mode: "light" } }).expect(
      200,
    );

    const res = await profile(session).expect(200);
    expect(res.body.theme).toEqual({ palette: "brisa", mode: "light" });
    expect(res.body.locale).toBe("es");
    expect(res.body.name).toBe("Bea");
    const doc = await UserModel.findById(session.user.id).lean();
    expect(doc?.theme).toEqual({ palette: "brisa", mode: "light" });
  });

  it("keeps a theme sent with a new password, through the write that bumps the token version", async () => {
    const session = await signedInUser({
      name: "Cris",
      email: "cris@theme.test",
      password: PASSWORD,
    });

    const res = await put(session, {
      theme: { palette: "tinta", mode: "system" },
      password: "NewPassword123!",
      currentPassword: PASSWORD,
    }).expect(200);

    expect(res.body.theme).toEqual({ palette: "tinta", mode: "system" });
    const doc = await UserModel.findById(session.user.id).lean();
    expect(doc?.theme).toEqual({ palette: "tinta", mode: "system" });
    expect(doc?.tokenVersion).toBe(1);
  });
});
