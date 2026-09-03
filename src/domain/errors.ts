import { ErrorCode } from "../shared/errorCodes";

export class DomainValidationError extends Error {
  field?: string;
  // Stable machine-readable code; defaults to VALIDATION at the API boundary.
  code?: ErrorCode;

  constructor(message: string, field?: string, code?: ErrorCode) {
    super(message);
    this.name = "DomainValidationError";
    this.field = field;
    this.code = code;
  }
}
