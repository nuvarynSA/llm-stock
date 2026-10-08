/**
 * Errores tipados de `GroqService` (spec `compartido/17`) — permiten que el controller/
 * frontend distingan 429 (con `retryAfter` si Groq lo mandó) de 5xx/timeout, sin reintento
 * automático (quemaría cupo del tier gratuito).
 */
export class GroqRateLimitError extends Error {
  constructor(public readonly retryAfter: number | null) {
    super('Se alcanzó el límite de consultas a Groq.');
    this.name = 'GroqRateLimitError';
  }
}

export class GroqUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroqUnavailableError';
  }
}

/**
 * Cuota propia agotada (spec `compartido/20`) — lanzada por `IaQuotaService.verificar()`
 * ANTES de llamar a Groq, nunca por la SDK. `used`/`limit` son cantidad de consultas para
 * `DAILY`/`MONTHLY`, USD para `BUDGET`. `resetAt` va en ISO con offset `-03:00` (horario de
 * Argentina — ver `quota/fecha-argentina.util.ts`).
 */
export class IaQuotaExceededError extends Error {
  constructor(
    public readonly type: 'DAILY' | 'MONTHLY' | 'BUDGET',
    public readonly used: number,
    public readonly limit: number,
    public readonly resetAt: string,
  ) {
    super(`Cuota de IA agotada (${type}): ${used}/${limit}.`);
    this.name = 'IaQuotaExceededError';
  }
}
