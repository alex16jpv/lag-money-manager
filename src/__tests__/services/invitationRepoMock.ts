import { ISharedInvitationRepository } from "../../domain/repositories/sharedInvitation/ISharedInvitationRepository";

export const mockInvitationRepo =
  (): jest.Mocked<ISharedInvitationRepository> => ({
    getById: jest.fn().mockResolvedValue(null),
    sentChangesSince: jest.fn().mockResolvedValue([]),
    receivedChangesSince: jest.fn().mockResolvedValue([]),
    listByGroup: jest.fn(),
    listAnswerable: jest.fn(),
    countWaitingBy: jest.fn().mockResolvedValue(0),
    findLive: jest.fn().mockResolvedValue(null),
    openOne: jest.fn(),
    answer: jest.fn().mockResolvedValue(null),
    withdraw: jest.fn().mockResolvedValue(null),
    withdrawAll: jest.fn().mockResolvedValue(0),
    refreshGroup: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(null),
    leaveAll: jest.fn().mockResolvedValue(0),
    memberships: jest.fn().mockResolvedValue([]),
    membershipsPage: jest.fn(),
    inGroups: jest.fn().mockResolvedValue([]),
    hasJoined: jest.fn().mockResolvedValue(false),
  });
