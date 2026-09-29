export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
  get retryable(): boolean {
    return this.options.retryable ?? true;
  }
}

export class RateLimitedError extends ProviderError {
  constructor(provider: string, public readonly retryAfterMs: number) {
    super(provider, `rate limited, retry after ${retryAfterMs}ms`, { retryable: true, status: 429 });
    this.name = "RateLimitedError";
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
