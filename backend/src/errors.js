export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const notFound = (msg) => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
