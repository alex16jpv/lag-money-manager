jest.mock("../../app/factories/captchaFactory", () => ({
  createCaptchaVerifier: () => ({
    verify: async () => ({ passed: true }),
  }),
}));
