import { BadRequestException, Injectable } from '@nestjs/common';
import { MedioPago, Prisma, TipoMovimientoTesoreria } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  col,
  Columna,
  LIMITE_RESULTADOS,
  metadata,
  metrica,
  metricas,
  ResultadoPresentable,
} from '../presentacion/presentacion';
import { rangoFecha } from './rango-fecha.util';

export type ModoConsultarTesoreria = 'resumen' | 'porFecha' | 'movimientos';

const MODOS_VALIDOS: ModoConsultarTesoreria[] = [
  'resumen',
  'porFecha',
  'movimientos',
];

// Medios que componen Tesorería Banco (mismo criterio que `CajaService`, `MEDIOS_BANCO`).
const MEDIOS_BANCO: MedioPago[] = [MedioPago.TRANSFERENCIA, MedioPago.TARJETA];

export interface ConsultarTesoreriaArgs {
  desde: string;
  hasta: string;
  modo?: ModoConsultarTesoreria | null;
}

export interface PorFechaTesoreriaDto {
  fecha: string;
  ingresos: number;
  egresos: number;
}

export interface MovimientoTesoreriaDto {
  fecha: string;
  concepto: string;
  tipo: TipoMovimientoTesoreria;
  cuenta: 'Efectivo' | 'Banco';
  importe: number;
}

export interface ConsultarTesoreriaResultado extends ResultadoPresentable {
  // modo 'resumen' (default, spec `compartido/17`)
  totalIngresos?: number;
  totalEgresos?: number;
  saldoNeto?: number;
  operaciones?: number;
  // K2 — desglose efectivo vs. bancos, también incluido en modo 'resumen'
  efectivo?: number;
  bancos?: number;

  // modo 'porFecha' (K3) — evolución día por día, tabla fecha|ingresos|egresos
  porFecha?: PorFechaTesoreriaDto[];

  // modo 'movimientos' (K4) — listado de movimientos individuales
  movimientos?: MovimientoTesoreriaDto[];

  // pagination de modos tabulares (`porFecha`, `movimientos`)
  total?: number;
  limit?: number;
  sinResultados?: true;
}

// Tope de filas tabulares (spec `compartido/19`): ninguna tool devuelve más de 50 registros.
const LIMIT = LIMITE_RESULTADOS;

const COLUMNAS_POR_FECHA: Columna[] = [
  col.date('fecha', 'Fecha'),
  col.currency('ingresos', 'Ingresos'),
  col.currency('egresos', 'Egresos'),
];

const COLUMNAS_MOVIMIENTOS: Columna[] = [
  col.date('fecha', 'Fecha'),
  col.text('concepto', 'Concepto'),
  col.status('tipo', 'Tipo'),
  col.text('cuenta', 'Cuenta'),
  col.currency('importe', 'Importe'),
];

/**
 * Tool `consultarTesoreria` (spec `compartido/17`, modos `porFecha`/`movimientos` en
 * `compartido/21`) — lectura pura sobre `MovimientoTesoreria`. `TipoMovimientoTesoreria` es
 * un enum distinto de `TipoMovimientoCaja` (mismos nombres, dominios distintos, no
 * confundir). Decisión cerrada con el usuario (2026-09-07): sin filtro de producto/
 * categoría/proveedor, solo rango de fechas.
 *
 * `porFecha` (K3) replica el agrupamiento por día de `CajaService.tesoreriaConsolidado()`
 * con Prisma directo (mismo motivo que el resto del módulo: no importar `CajaModule`), pero
 * simplificado a `ingresos`/`egresos` brutos por fecha (sin separar efectivo/bancos, eso ya
 * lo cubre `resumen`/K2) — spec `compartido/19` deja gráficos fuera de alcance, así que viaja
 * como tabla. `movimientos` (K4) replica `CajaService.movimientosTesoreria()` con `LIMIT = 50`
 * en vez de la paginación `page`/`pageSize` de la UI, mismo criterio que el resto de este
 * módulo.
 */
@Injectable()
export class TesoreriaToolService {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    args: ConsultarTesoreriaArgs,
  ): Promise<ConsultarTesoreriaResultado> {
    if (
      args.modo != null &&
      !MODOS_VALIDOS.includes(args.modo as ModoConsultarTesoreria)
    ) {
      throw new BadRequestException(`modo inválido: ${args.modo}`);
    }

    switch (args.modo) {
      case 'porFecha':
        return this.porFecha(args);
      case 'movimientos':
        return this.movimientos(args);
      default:
        return this.resumen(args);
    }
  }

  private async resumen(
    args: ConsultarTesoreriaArgs,
  ): Promise<ConsultarTesoreriaResultado> {
    const { gte, lt } = rangoFecha(args.desde, args.hasta);

    const movimientos = await this.prisma.movimientoTesoreria.findMany({
      where: { fecha: { gte, lt } },
      select: { tipo: true, importe: true, medio: true },
    });

    if (movimientos.length === 0) {
      return {
        totalIngresos: 0,
        totalEgresos: 0,
        saldoNeto: 0,
        operaciones: 0,
        efectivo: 0,
        bancos: 0,
        sinResultados: true,
        metricas: metricas(
          metrica('totalIngresos', 'Ingresos', 0, 'currency'),
          metrica('totalEgresos', 'Egresos', 0, 'currency'),
          metrica('saldoNeto', 'Saldo neto', 0, 'currency'),
          metrica('operaciones', 'Operaciones', 0, 'number'),
          metrica('efectivo', 'Efectivo', 0, 'currency'),
          metrica('bancos', 'Bancos', 0, 'currency'),
        ),
        columnas: [],
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const totalIngresos = movimientos
      .filter((m) => m.tipo === TipoMovimientoTesoreria.INGRESO)
      .reduce((acc, m) => acc + Number(m.importe), 0);
    const totalEgresos = movimientos
      .filter((m) => m.tipo === TipoMovimientoTesoreria.EGRESO)
      .reduce((acc, m) => acc + Number(m.importe), 0);
    const saldoNeto = totalIngresos - totalEgresos;
    const efectivo = this.netoPorMedios(movimientos, [MedioPago.EFECTIVO]);
    const bancos = this.netoPorMedios(movimientos, MEDIOS_BANCO);

    return {
      totalIngresos,
      totalEgresos,
      saldoNeto,
      operaciones: movimientos.length,
      efectivo,
      bancos,
      metricas: metricas(
        metrica('totalIngresos', 'Ingresos', totalIngresos, 'currency'),
        metrica('totalEgresos', 'Egresos', totalEgresos, 'currency'),
        metrica('saldoNeto', 'Saldo neto', saldoNeto, 'currency'),
        metrica('operaciones', 'Operaciones', movimientos.length, 'number'),
        metrica('efectivo', 'Efectivo', efectivo, 'currency'),
        metrica('bancos', 'Bancos', bancos, 'currency'),
      ),
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** K2 — saldo neto (INGRESO - EGRESO) restringido a un conjunto de `medio`, mismo criterio
   *  de signo que `CajaService.saldoTesoreriaPorMedios`: nunca incluye `medio: null`. */
  private netoPorMedios(
    movimientos: {
      tipo: TipoMovimientoTesoreria;
      importe: Prisma.Decimal;
      medio: MedioPago | null;
    }[],
    medios: MedioPago[],
  ): number {
    return movimientos
      .filter((m) => m.medio && medios.includes(m.medio))
      .reduce(
        (acc, m) =>
          acc +
          (m.tipo === TipoMovimientoTesoreria.EGRESO ? -1 : 1) *
            Number(m.importe),
        0,
      );
  }

  /** K3 — evolución día por día (ingresos/egresos brutos, sin separar efectivo/bancos). */
  private async porFecha(
    args: ConsultarTesoreriaArgs,
  ): Promise<ConsultarTesoreriaResultado> {
    const { gte, lt } = rangoFecha(args.desde, args.hasta);

    const movimientos = await this.prisma.movimientoTesoreria.findMany({
      where: { fecha: { gte, lt } },
      select: { fecha: true, tipo: true, importe: true },
    });

    if (movimientos.length === 0) {
      return {
        porFecha: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_POR_FECHA,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const porFechaMap = new Map<string, { ingresos: number; egresos: number }>();
    for (const m of movimientos) {
      const fechaKey = m.fecha.toISOString().slice(0, 10);
      const actual = porFechaMap.get(fechaKey) ?? { ingresos: 0, egresos: 0 };
      if (m.tipo === TipoMovimientoTesoreria.INGRESO) {
        actual.ingresos += Number(m.importe);
      } else {
        actual.egresos += Number(m.importe);
      }
      porFechaMap.set(fechaKey, actual);
    }

    const filas = [...porFechaMap.entries()]
      .map(([fecha, { ingresos, egresos }]) => ({ fecha, ingresos, egresos }))
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    const mostrado = filas.slice(0, LIMIT);

    return {
      porFecha: mostrado,
      total: filas.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_POR_FECHA,
      filas: mostrado,
      metadata: metadata(filas.length, mostrado.length),
    };
  }

  /** K4 — listado de movimientos individuales, `LIMIT = 50` en vez de paginación UI. */
  private async movimientos(
    args: ConsultarTesoreriaArgs,
  ): Promise<ConsultarTesoreriaResultado> {
    const { gte, lt } = rangoFecha(args.desde, args.hasta);

    const movimientos = await this.prisma.movimientoTesoreria.findMany({
      where: { fecha: { gte, lt } },
      orderBy: { fecha: 'desc' },
    });

    if (movimientos.length === 0) {
      return {
        movimientos: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_MOVIMIENTOS,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const detalle = movimientos.slice(0, LIMIT).map((m) => ({
      fecha: m.fecha.toISOString(),
      concepto: m.concepto,
      tipo: m.tipo,
      cuenta:
        m.medio === MedioPago.EFECTIVO ? ('Efectivo' as const) : ('Banco' as const),
      importe: Number(m.importe),
    }));

    return {
      movimientos: detalle,
      total: movimientos.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_MOVIMIENTOS,
      filas: detalle,
      metadata: metadata(movimientos.length, detalle.length),
    };
  }
}
