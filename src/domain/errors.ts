export class DomainValidationError extends Error {
  field?: string;
  // Stable machine-readable code; defaults to VALIDATION at the API boundary.
  code?: string;

  constructor(message: string, field?: string, code?: string) {
    super(message);
    this.name = "DomainValidationError";
    this.field = field;
    this.code = code;
  }
}
