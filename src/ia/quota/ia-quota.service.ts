import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IaQuotaExceededError } from '../groq/groq-errors';
import {
  inicioDiaArgentina,
  inicioDiaSiguienteArgentina,
  inicioMesArgentina,
  inicioMesSiguienteArgentina,
  isoConOffsetArgentina,
} from './fecha-argentina.util';

export interface EstadoCuotaIa {
  diario: { usado: number; limite: number; resetAt: string };
  mensual: { usado: number; limite: number; resetAt: string };
  presupuesto: { usadoUsd: number; limiteUsd: number };
}

/**
 * Cuotas GLOBALES del ERP entero (spec `compartido/20`, decisión cerrada 2026-09-09: "20/día y
 * 600/mes se cuentan sumando TODOS los usuarios", no por usuario) — distinto de
 * `IaThrottlerGuard`, que sí es por usuario. Cuenta TODAS las filas de `ConsumoIa` sin importar
 * `resultado`: una consulta que falló igual consumió cupo ("una consulta se considera consumida
 * cuando el backend acepta la solicitud").
 */
@Injectable()
export class IaQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private limiteDiario(): number {
    return this.config.get<number>('IA_DAILY_QUERY_LIMIT')!;
  }

  private limiteMensual(): number {
    return this.config.get<number>('IA_MONTHLY_QUERY_LIMIT')!;
  }

  private presupuestoMensualUsd(): number {
    return this.config.get<number>('IA_MONTHLY_BUDGET_USD')!;
  }

  /** Corre las 3 verificaciones (día, mes, presupuesto) y lanza `IaQuotaExceededError` en la primera que falle. */
  async verificar(ahora: Date = new Date()): Promise<void> {
    const inicioDia = inicioDiaArgentina(ahora);
    const inicioDiaSiguiente = inicioDiaSiguienteArgentina(ahora);
    const inicioMes = inicioMesArgentina(ahora);
    const inicioMesSiguiente = inicioMesSiguienteArgentina(ahora);

    const limiteDiario = this.limiteDiario();
    const consultasDia = await this.prisma.consumoIa.count({
      where: { fecha: { gte: inicioDia, lt: inicioDiaSiguiente } },
    });
    if (consultasDia >= limiteDiario) {
      throw new IaQuotaExceededError(
        'DAILY',
        consultasDia,
        limiteDiario,
        isoConOffsetArgentina(inicioDiaSiguiente),
      );
    }

    const limiteMensual = this.limiteMensual();
    const consultasMes = await this.prisma.consumoIa.count({
      where: { fecha: { gte: inicioMes, lt: inicioMesSiguiente } },
    });
    if (consultasMes >= limiteMensual) {
      throw new IaQuotaExceededError(
        'MONTHLY',
        consultasMes,
        limiteMensual,
        isoConOffsetArgentina(inicioMesSiguiente),
      );
    }

    const presupuestoUsd = this.presupuestoMensualUsd();
    const costoUsadoUsd = await this.costoDelMes(inicioMes, inicioMesSiguiente);
    if (costoUsadoUsd >= presupuestoUsd) {
      throw new IaQuotaExceededError(
        'BUDGET',
        costoUsadoUsd,
        presupuestoUsd,
        isoConOffsetArgentina(inicioMesSiguiente),
      );
    }
  }

  /**
   * Verifica cuota y, si pasa, inserta la fila `ConsumoIa` en estado `PENDIENTE` — ESE insert
   * es lo que consume el cupo (decisión cerrada: "una consulta se considera consumida cuando el
   * backend acepta la solicitud"), antes de llamar a Groq. Devuelve el id para que
   * `IaUsageService.registrar()` la complete después.
   */
  async reservar(usuarioId: string): Promise<string> {
    await this.verificar();

    const fila = await this.prisma.consumoIa.create({
      data: {
        usuarioId,
        modelo: '',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cantidadToolCalls: 0,
        iteraciones: 0,
        duracionMs: 0,
        costoUsd: new Prisma.Decimal(0),
        resultado: 'PENDIENTE',
      },
    });

    return fila.id;
  }

  /** Estado actual de la cuota (para `GET /ia/cuota`) — de solo lectura, no consume cupo. */
  async estado(ahora: Date = new Date()): Promise<EstadoCuotaIa> {
    const inicioDia = inicioDiaArgentina(ahora);
    const inicioDiaSiguiente = inicioDiaSiguienteArgentina(ahora);
    const inicioMes = inicioMesArgentina(ahora);
    const inicioMesSiguiente = inicioMesSiguienteArgentina(ahora);

    const [consultasDia, consultasMes, costoUsadoUsd] = await Promise.all([
      this.prisma.consumoIa.count({
        where: { fecha: { gte: inicioDia, lt: inicioDiaSiguiente } },
      }),
      this.prisma.consumoIa.count({
        where: { fecha: { gte: inicioMes, lt: inicioMesSiguiente } },
      }),
      this.costoDelMes(inicioMes, inicioMesSiguiente),
    ]);

    return {
      diario: {
        usado: consultasDia,
        limite: this.limiteDiario(),
        resetAt: isoConOffsetArgentina(inicioDiaSiguiente),
      },
      mensual: {
        usado: consultasMes,
        limite: this.limiteMensual(),
        resetAt: isoConOffsetArgentina(inicioMesSiguiente),
      },
      presupuesto: {
        usadoUsd: costoUsadoUsd,
        limiteUsd: this.presupuestoMensualUsd(),
      },
    };
  }

  private async costoDelMes(
    inicioMes: Date,
    inicioMesSiguiente: Date,
  ): Promise<number> {
    const agregado = await this.prisma.consumoIa.aggregate({
      _sum: { costoUsd: true },
      where: { fecha: { gte: inicioMes, lt: inicioMesSiguiente } },
    });
    return agregado._sum.costoUsd ? Number(agregado._sum.costoUsd) : 0;
  }
}
