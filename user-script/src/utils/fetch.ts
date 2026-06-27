export class FetchError extends Error {
  private readonly _response?: Response;

  constructor(response: Response | string) {
    if (typeof response === 'string') {
      super(response);
    } else {
      super(`Fetch failed with status ${response.status} ${response.statusText}`);
      this._response = response;
    }
  }

  get response(): Response | undefined {
    return this._response;
  }
}

export function isFetchError(error: unknown): error is FetchError {
  return error instanceof FetchError;
}
