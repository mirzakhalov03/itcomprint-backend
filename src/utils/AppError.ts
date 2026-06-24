/**
 * Operational HTTP error. Domain code raises `throw new AppError(404, 'Event not found')`
 * and the error middleware turns it into a consistent JSON response — so services own
 * their failure cases instead of each controller hand-rolling a status + body.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
