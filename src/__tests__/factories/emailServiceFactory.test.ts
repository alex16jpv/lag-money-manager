const createEmailProviders = jest.fn(() => []);

jest.mock("../../infrastructure/email/emailProviders", () => ({
  createEmailProviders,
}));
jest.mock("../../app/factories/RepositoryFactory", () => ({
  __esModule: true,
  default: {
    getRateCounterRepository: () => ({}),
    getEmailDeliveryRepository: () => ({}),
    getEmailSuppressionRepository: () => ({}),
  },
}));

import { createEmailService } from "../../app/factories/emailServiceFactory";

describe("createEmailService", () => {
  it("builds the provider chain once per process, so every email service shares one SES client", () => {
    createEmailService();
    createEmailService();
    expect(createEmailProviders).toHaveBeenCalledTimes(1);
  });
});
