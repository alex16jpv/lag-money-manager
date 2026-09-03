import { SessionSummary } from "../../domain/repositories/refreshSession/IRefreshSessionRepository";

export interface SessionView extends SessionSummary {
  // The family the requesting access token belongs to ("this device").
  current: boolean;
}
