export class RideDomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RideDomainError";
  }
}

export function notFound(): RideDomainError {
  return new RideDomainError("RIDE_NOT_FOUND", 404, "The requested trip was not found.");
}

export function invalid(code: string, message: string): RideDomainError {
  return new RideDomainError(code, 400, message);
}

export function conflict(code: string, message: string): RideDomainError {
  return new RideDomainError(code, 409, message);
}

export function forbidden(): RideDomainError {
  return new RideDomainError("RIDE_ACTION_NOT_ALLOWED", 403, "You cannot perform this action.");
}
