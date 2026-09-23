jest.mock("../../shared/unitOfWork", () => ({
  withTransaction: jest.fn((fn: (session: unknown) => unknown) => fn({})),
}));

import { SharedInvitationService } from "../../app/services/SharedInvitationService";
import { Contact } from "../../domain/entities/Contact";
import { SharedGroup } from "../../domain/entities/SharedGroup";
import { SharedInvitation } from "../../domain/entities/SharedInvitation";
import { User } from "../../domain/entities/User";
import { IContactRepository } from "../../domain/repositories/contact/IContactRepository";
import { ISharedGroupRepository } from "../../domain/repositories/sharedGroup/ISharedGroupRepository";
import { IUserRepository } from "../../domain/repositories/user/IUserRepository";
import {
  INVITATION_LIFETIME_DAYS,
  MAX_PENDING_INVITATIONS_PER_USER,
} from "../../shared/constants";
import { mockInvitationRepo } from "./invitationRepoMock";

const inviterId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac71";
const inviteeId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac72";
const groupId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac73";
const contactId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac74";
const invitationId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac75";
const DAY = 24 * 60 * 60 * 1000;

const inviter = new User({
  id: inviterId,
  name: "John Doe",
  email: "john@example.com",
  password: "x",
  currency: "COP",
});
const invitee = new User({
  id: inviteeId,
  name: "Beto Cano",
  email: "beto@example.com",
  password: "x",
  currency: "COP",
});

const makeGroup = (props: Partial<SharedGroup> = {}): SharedGroup =>
  new SharedGroup({
    id: groupId,
    name: "Night out",
    color: "PURPLE",
    userId: inviterId,
    currency: "COP",
    participants: [{ contactId: null }, { contactId }],
    ...props,
  });

const makeContact = (props: Partial<Contact> = {}): Contact =>
  new Contact({
    id: contactId,
    name: "Beto",
    email: "beto@example.com",
    userId: inviterId,
    ...props,
  });

const makeInvitation = (
  props: Partial<SharedInvitation> = {},
): SharedInvitation =>
  new SharedInvitation({
    id: invitationId,
    userId: inviterId,
    groupId,
    contactId,
    email: "beto@example.com",
    expiresAt: new Date(Date.now() + 10 * DAY),
    groupName: "Night out",
    groupCurrency: "COP",
    inviterName: "John Doe",
    inviterEmail: "john@example.com",
    ...props,
  });

describe("SharedInvitationService", () => {
  let repo: ReturnType<typeof mockInvitationRepo>;
  let groups: jest.Mocked<ISharedGroupRepository>;
  let contacts: jest.Mocked<IContactRepository>;
  let users: jest.Mocked<IUserRepository>;
  let service: SharedInvitationService;

  beforeEach(() => {
    repo = mockInvitationRepo();
    groups = {
      getByIdIncludingArchived: jest.fn().mockResolvedValue(makeGroup()),
    } as unknown as jest.Mocked<ISharedGroupRepository>;
    contacts = {
      getOwnById: jest.fn().mockResolvedValue(makeContact()),
      update: jest.fn().mockResolvedValue(makeContact()),
    } as unknown as jest.Mocked<IContactRepository>;
    users = {
      getById: jest
        .fn()
        .mockImplementation(async (id: string) =>
          id === inviterId ? inviter : id === inviteeId ? invitee : null,
        ),
    } as unknown as jest.Mocked<IUserRepository>;
    repo.openOne.mockImplementation(async (invitation) => ({
      invitation,
      created: true,
    }));
    service = new SharedInvitationService(repo, groups, contacts, users);
  });

  describe("invite", () => {
    it("addresses the contact's email, snapshots who sends it, and waits 30 days", async () => {
      const outcome = { created: false };
      const before = Date.now();

      const sent = await service.invite(groupId, contactId, inviterId, outcome);

      expect(outcome.created).toBe(true);
      expect(sent).toMatchObject({
        groupId,
        contactId,
        email: "beto@example.com",
        status: "PENDING",
      });
      const written = repo.openOne.mock.calls[0]?.[0] as SharedInvitation;
      expect(written).toMatchObject({
        groupName: "Night out",
        groupColor: "PURPLE",
        groupCurrency: "COP",
        inviterName: "John Doe",
        inviterEmail: "john@example.com",
      });
      const lifetime = written.expiresAt.getTime() - before;
      expect(lifetime).toBeGreaterThanOrEqual(INVITATION_LIFETIME_DAYS * DAY);
      expect(lifetime).toBeLessThan(INVITATION_LIFETIME_DAYS * DAY + 5_000);
    });

    it("never looks the address up, so it cannot tell anybody whether it has an account", async () => {
      await service.invite(groupId, contactId, inviterId);

      expect(users.getById).toHaveBeenCalledTimes(1);
      expect(users.getById).toHaveBeenCalledWith(inviterId);
    });

    it("never shows the invited person who they are to the inviter", async () => {
      repo.openOne.mockResolvedValue({
        invitation: makeInvitation({ inviteeId, status: "ACCEPTED" }),
        created: false,
      });

      const sent = await service.invite(groupId, contactId, inviterId);

      expect(sent).not.toHaveProperty("inviteeId");
      expect(sent.status).toBe("ACCEPTED");
    });

    it("answers somebody else's group like a missing one", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ userId: inviteeId }),
      );

      await expect(
        service.invite(groupId, contactId, inviterId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("refuses an archived group", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ archivedAt: new Date() }),
      );

      await expect(
        service.invite(groupId, contactId, inviterId),
      ).rejects.toMatchObject({ code: "RESOURCE_ARCHIVED" });
    });

    it("refuses somebody who is not in the group", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ participants: [{ contactId: null }] }),
      );

      await expect(
        service.invite(groupId, contactId, inviterId),
      ).rejects.toMatchObject({ code: "PARTICIPANT_NOT_IN_GROUP" });
    });

    it("answers an archived contact like a missing one", async () => {
      contacts.getOwnById.mockResolvedValue(
        makeContact({ archivedAt: new Date() }),
      );

      await expect(
        service.invite(groupId, contactId, inviterId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("needs an email to address it to", async () => {
      contacts.getOwnById.mockResolvedValue(makeContact({ email: undefined }));

      await expect(
        service.invite(groupId, contactId, inviterId),
      ).rejects.toMatchObject({ code: "CONTACT_HAS_NO_EMAIL" });
    });

    it("refuses the inviter's own email", async () => {
      contacts.getOwnById.mockResolvedValue(
        makeContact({ email: "john@example.com" }),
      );

      await expect(
        service.invite(groupId, contactId, inviterId),
      ).rejects.toMatchObject({ code: "INVITATION_TO_SELF" });
    });

    it("refuses one more waiting invitation past the cap", async () => {
      repo.countWaitingBy.mockResolvedValue(MAX_PENDING_INVITATIONS_PER_USER);

      await expect(
        service.invite(groupId, contactId, inviterId),
      ).rejects.toMatchObject({ code: "INVITATION_LIMIT_REACHED" });
      expect(repo.openOne).not.toHaveBeenCalled();
    });

    it("still answers the live invitation of this person at the cap: nothing new waits", async () => {
      repo.countWaitingBy.mockResolvedValue(MAX_PENDING_INVITATIONS_PER_USER);
      repo.findLive.mockResolvedValue(makeInvitation());
      const outcome = { created: true };

      const sent = await service.invite(groupId, contactId, inviterId, outcome);

      expect(sent.id).toBe(invitationId);
      expect(outcome.created).toBe(false);
      expect(repo.openOne).not.toHaveBeenCalled();
    });

    it("does not count an expired one as live at the cap", async () => {
      repo.countWaitingBy.mockResolvedValue(MAX_PENDING_INVITATIONS_PER_USER);
      repo.findLive.mockResolvedValue(
        makeInvitation({ expiresAt: new Date(Date.now() - DAY) }),
      );

      await expect(
        service.invite(groupId, contactId, inviterId),
      ).rejects.toMatchObject({ code: "INVITATION_LIMIT_REACHED" });
    });
  });

  describe("withdraw", () => {
    it("ends a live invitation", async () => {
      repo.getById.mockResolvedValue(makeInvitation());
      repo.withdraw.mockResolvedValue(
        makeInvitation({ status: "WITHDRAWN", withdrawnAt: new Date() }),
      );

      const sent = await service.withdraw(groupId, invitationId, inviterId);

      expect(sent.status).toBe("WITHDRAWN");
    });

    it("answers one that already ended as it is", async () => {
      repo.getById.mockResolvedValue(makeInvitation({ status: "DECLINED" }));

      const sent = await service.withdraw(groupId, invitationId, inviterId);

      expect(sent.status).toBe("DECLINED");
    });

    it("answers another user's invitation, or one of another group, like a missing one", async () => {
      repo.getById.mockResolvedValue(makeInvitation({ userId: inviteeId }));
      await expect(
        service.withdraw(groupId, invitationId, inviterId),
      ).rejects.toMatchObject({ statusCode: 404 });

      repo.getById.mockResolvedValue(makeInvitation({ groupId: contactId }));
      await expect(
        service.withdraw(groupId, invitationId, inviterId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("listReceived", () => {
    it("lists what waits for the email on the caller's profile", async () => {
      repo.listAnswerable.mockResolvedValue({
        data: [makeInvitation()],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
          hasMore: false,
          nextCursor: null,
        },
      });

      const page = await service.listReceived(inviteeId, {
        limit: 20,
        offset: 0,
      });

      expect(repo.listAnswerable).toHaveBeenCalledWith(
        "beto@example.com",
        expect.any(Date),
        { limit: 20, offset: 0 },
      );
      expect(page.data[0]).toMatchObject({
        groupName: "Night out",
        inviterName: "John Doe",
      });
      expect(page.data[0]).not.toHaveProperty("contactId");
    });
  });

  describe("accept", () => {
    beforeEach(() => {
      repo.getById.mockResolvedValue(makeInvitation());
      repo.answer.mockResolvedValue(
        makeInvitation({ status: "ACCEPTED", inviteeId }),
      );
    });

    it("joins inside a transaction, and writes nothing into the inviter's contacts", async () => {
      const answered = await service.accept(invitationId, inviteeId);

      expect(answered.status).toBe("ACCEPTED");
      expect(repo.answer).toHaveBeenCalledWith(
        invitationId,
        "ACCEPTED",
        inviteeId,
        expect.any(Date),
        {},
      );
      expect(contacts.update).not.toHaveBeenCalled();
    });

    it("refuses an invitation whose sender deleted their account", async () => {
      users.getById.mockImplementation(async (id: string) =>
        id === inviteeId ? invitee : null,
      );

      await expect(
        service.accept(invitationId, inviteeId),
      ).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
    });

    it("answers somebody else's answered invitation to this address like a missing one", async () => {
      repo.getById.mockResolvedValue(
        makeInvitation({ status: "ACCEPTED", inviteeId: inviterId }),
      );

      await expect(
        service.decline(invitationId, inviteeId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("answers an invitation addressed to somebody else like a missing one", async () => {
      repo.getById.mockResolvedValue(
        makeInvitation({ email: "someone@example.com" }),
      );

      await expect(
        service.accept(invitationId, inviteeId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("refuses the inviter answering their own invitation", async () => {
      repo.getById.mockResolvedValue(
        makeInvitation({ email: "john@example.com" }),
      );

      await expect(
        service.accept(invitationId, inviterId),
      ).rejects.toMatchObject({ code: "INVITATION_TO_SELF" });
    });

    it("is idempotent for the person who already accepted", async () => {
      repo.getById.mockResolvedValue(
        makeInvitation({ status: "ACCEPTED", inviteeId }),
      );

      const answered = await service.accept(invitationId, inviteeId);

      expect(answered.status).toBe("ACCEPTED");
      expect(repo.answer).not.toHaveBeenCalled();
    });

    it.each([
      ["withdrawn", { status: "WITHDRAWN" as const }],
      ["declined", { status: "DECLINED" as const, inviteeId }],
      ["out of time", { expiresAt: new Date(Date.now() - 1000) }],
    ])("refuses one that was %s", async (_label, props) => {
      repo.getById.mockResolvedValue(makeInvitation(props));

      await expect(
        service.accept(invitationId, inviteeId),
      ).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
    });

    it("refuses a group in another currency, which can only be declined", async () => {
      repo.getById.mockResolvedValue(makeInvitation({ groupCurrency: "EUR" }));

      await expect(
        service.accept(invitationId, inviteeId),
      ).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
      expect(repo.answer).not.toHaveBeenCalled();
    });

    it("refuses a group archived, or a person taken out, a moment ago", async () => {
      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ archivedAt: new Date() }),
      );
      await expect(
        service.accept(invitationId, inviteeId),
      ).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });

      groups.getByIdIncludingArchived.mockResolvedValue(
        makeGroup({ participants: [{ contactId: null }] }),
      );
      await expect(
        service.accept(invitationId, inviteeId),
      ).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
    });

    it("refuses joining the same group twice through two contacts", async () => {
      repo.hasJoined.mockResolvedValue(true);

      await expect(
        service.accept(invitationId, inviteeId),
      ).rejects.toMatchObject({ code: "PARTICIPANT_ALREADY_IN_GROUP" });
    });

    it("refuses when the invitation stopped waiting between the read and the write", async () => {
      repo.answer.mockResolvedValue(null);

      await expect(
        service.accept(invitationId, inviteeId),
      ).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
      expect(contacts.update).not.toHaveBeenCalled();
    });
  });

  describe("decline", () => {
    it("declines, whatever the currency", async () => {
      repo.getById.mockResolvedValue(makeInvitation({ groupCurrency: "EUR" }));
      repo.answer.mockResolvedValue(
        makeInvitation({ status: "DECLINED", inviteeId }),
      );

      const answered = await service.decline(invitationId, inviteeId);

      expect(answered.status).toBe("DECLINED");
    });

    it("refuses one that can no longer be answered", async () => {
      repo.getById.mockResolvedValue(makeInvitation({ status: "WITHDRAWN" }));

      await expect(
        service.decline(invitationId, inviteeId),
      ).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
    });
  });

  describe("leave", () => {
    const joined = () =>
      makeInvitation({ status: "ACCEPTED", inviteeId, answeredAt: new Date() });

    it("leaves a group you joined, and only that invitation moves", async () => {
      repo.getById.mockResolvedValue(joined());
      repo.leave.mockResolvedValue(
        makeInvitation({ status: "LEFT", inviteeId, leftAt: new Date() }),
      );

      const left = await service.leave(invitationId, inviteeId);

      expect(repo.leave).toHaveBeenCalledWith(
        invitationId,
        inviteeId,
        expect.any(Date),
      );
      expect(left.status).toBe("LEFT");
      expect(left.leftAt).toBeInstanceOf(Date);
    });

    it("answers a second leave with the invitation as it is", async () => {
      repo.getById.mockResolvedValue(
        makeInvitation({ status: "LEFT", inviteeId, leftAt: new Date() }),
      );

      const left = await service.leave(invitationId, inviteeId);

      expect(left.status).toBe("LEFT");
      expect(repo.leave).not.toHaveBeenCalled();
    });

    it("is not found for somebody who did not join with it", async () => {
      repo.getById.mockResolvedValue(joined());

      await expect(
        service.leave(invitationId, inviterId),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("refuses one the owner already stopped sharing", async () => {
      repo.getById.mockResolvedValue(
        makeInvitation({ status: "WITHDRAWN", inviteeId }),
      );

      await expect(
        service.leave(invitationId, inviteeId),
      ).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
    });
  });
});
