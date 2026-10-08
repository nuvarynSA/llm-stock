import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtPayload } from '../../login/interfaces/jwt-payload.interface';

/**
 * `POST /ia/consultar` — decisión cerrada con el usuario (task `compartido/17`, 2026-09-07):
 * "2 consultas por minuto **por usuario**", no por IP (el `ThrottlerGuard` genérico
 * trackea por IP vía `req.ip`). `JwtAuthGuard` (global, `APP_GUARD`) ya corrió antes de
 * este guard y dejó `req.user` seteado.
 */
@Injectable()
export class IaThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as JwtPayload | undefined;
    return user?.sub ?? (await super.getTracker(req));
  }

  /**
   * Mismo criterio que el 429 de `GroqRateLimitError` ("mensaje claro por tipo", decisión
   * cerrada task `compartido/17`): el default de `ThrottlerGuard` es en inglés
   * ("ThrottlerException: Too Many Requests"). Sin `retry-after` exacto porque
   * `ThrottlerGuard` no lo expone en `getErrorMessage` — la ventana es fija de 60s.
   */
  protected getErrorMessage(): Promise<string> {
    return Promise.resolve(
      'Se alcanzó el límite de consultas, probá de nuevo en un minuto.',
    );
  }
}
