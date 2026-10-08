import { BadRequestException, Injectable } from '@nestjs/common';
import {
  EstadoSesionCaja,
  MedioPago,
  Prisma,
  TipoMovimientoCaja,
  TipoMovimientoTesoreria,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  col,
  Columna,
  Fila,
  LIMITE_RESULTADOS,
  metadata,
  metrica,
  metricas,
  ResultadoPresentable,
} from '../presentacion/presentacion';
import { rangoFecha } from './rango-fecha.util';

export type ModoConsultarCaja = 'resumen' | 'sesiones' | 'sesionActual';

const MODOS_VALIDOS: ModoConsultarCaja[] = [
  'resumen',
  'sesiones',
  'sesionActual',
];

export interface ConsultarCajaArgs {
  desde?: string | null;
  hasta?: string | null;
  modo?: ModoConsultarCaja | null;
  /** Requerido junto con `modo: 'sesiones'` (K1) para el detalle de UNA sesión puntual. */
  sesionNumero?: number | null;
}

export interface FondosCajaDiariaResultado {
  sesionId: string;
  disponible: number;
}

export interface FondosDisponiblesResultado {
  cajaDiaria: FondosCajaDiariaResultado | null;
  tesoreriaEfectivo: number;
  tesoreriaBanco: number;
}

export interface PorMedioPagoDto {
  efectivo: number;
  tarjeta: number;
  transferencia: number;
}

export interface SesionHistorialDto {
  numero: number;
  fecha: string;
  horaApertura: string;
  horaCierre: string | null;
  total: number;
}

export interface MovimientoSesionDto {
  hora: string;
  concepto: string;
  tipo: TipoMovimientoCaja;
  medio: MedioPago | null;
  importe: number;
}

export interface SesionDetalleDto {
  numero: number;
  fecha: string;
  horaApertura: string;
  horaCierre: string | null;
  mediosDePago: MedioPago[];
  movimientos: MovimientoSesionDto[];
}

export interface ConsultarCajaResultado extends ResultadoPresentable {
  // modo 'resumen' (default, spec `compartido/17`)
  totalIngresos?: number;
  totalEgresos?: number;
  saldoNeto?: number;
  totalMontoInicial?: number;
  cantidadSesiones?: number;
  cantidadSesionesAbiertas?: number;
  cantidadSesionesCerradas?: number;
  fondosDisponibles?: FondosDisponiblesResultado;
  // K2 — desglose por medio de pago, también incluido en modo 'resumen'
  porMedioPago?: PorMedioPagoDto;

  // modo 'sesiones' sin sesionNumero (K1) — listado de sesiones cerradas del rango
  sesiones?: SesionHistorialDto[];
  // modo 'sesiones' con sesionNumero (K1) — detalle de UNA sesión puntual
  sesionDetalle?: SesionDetalleDto;
  sesionNoEncontrada?: true;
  ambiguo?: true;
  candidatos?: string[];

  // modo 'sesionActual' (K5) — foto del estado ACTUAL, no depende de desde/hasta
  hayCajaAbierta?: boolean;
  numeroSesion?: number;
  horaApertura?: string;
  montoInicial?: number;

  // pagination de modos tabulares (`sesiones` sin sesionNumero)
  total?: number;
  limit?: number;
  sinResultados?: true;
}

// Tope de filas tabulares (spec `compartido/19`): ninguna tool devuelve más de 50 registros.
const LIMIT = LIMITE_RESULTADOS;

const COLUMNAS_SESIONES: Columna[] = [
  col.number('numero', 'Número'),
  col.date('fecha', 'Fecha'),
  col.text('horaApertura', 'Apertura'),
  col.text('horaCierre', 'Cierre'),
  col.currency('total', 'Total'),
];

const COLUMNAS_SESION_DETALLE: Columna[] = [
  col.number('numero', 'Número'),
  col.date('fecha', 'Fecha'),
  col.text('horaApertura', 'Apertura'),
  col.text('horaCierre', 'Cierre'),
];

const COLUMNAS_SESION_ACTUAL: Columna[] = [
  col.number('numeroSesion', 'Número'),
  col.text('horaApertura', 'Apertura'),
  col.currency('montoInicial', 'Monto inicial'),
];

const TIPOS_INGRESO: TipoMovimientoCaja[] = [
  TipoMovimientoCaja.VENTA,
  TipoMovimientoCaja.COBRO,
  TipoMovimientoCaja.INGRESO,
];

// Medios que componen Tesorería Banco (mismo criterio que `CajaService`, `MEDIOS_BANCO`).
const MEDIOS_BANCO: MedioPago[] = [MedioPago.TRANSFERENCIA, MedioPago.TARJETA];

/**
 * Tool `consultarCaja` (spec `compartido/17`, modos `sesiones`/`sesionActual` en
 * `compartido/21`) — lectura pura sobre `SesionCaja`/`MovimientoCaja`. Decisión cerrada con
 * el usuario (2026-09-07): sin filtro de producto/categoría/proveedor (los movimientos de
 * caja no se relacionan con `Producto`), solo rango de fechas.
 *
 * `fondosDisponibles` (spec Fase 1c) replica `CajaService.fondosDisponibles()` con Prisma
 * directo en vez de importar `CajaModule`: ese módulo arrastra la cadena circular
 * `CajaModule` ↔ `VentasModule` ↔ `ComprasModule` (`forwardRef` en los tres), que `IaModule`
 * no necesita. Es un snapshot del estado ACTUAL (sesión abierta + saldos de Tesorería), no
 * depende de `desde`/`hasta` — se informa igual en el caso `sinResultados`.
 *
 * `sesiones` (K1) replica `CajaService.historial()`/`detalleSesion()` con Prisma directo, por
 * el mismo motivo. `sesionActual` (K5) es otra foto del estado ACTUAL, como
 * `fondosDisponibles` — no depende de `desde`/`hasta` ni usa `sinResultados`.
 */
@Injectable()
export class CajaToolService {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(args: ConsultarCajaArgs): Promise<ConsultarCajaResultado> {
    if (
      args.modo != null &&
      !MODOS_VALIDOS.includes(args.modo as ModoConsultarCaja)
    ) {
      throw new BadRequestException(`modo inválido: ${args.modo}`);
    }

    switch (args.modo) {
      case 'sesiones':
        return this.sesiones(args);
      case 'sesionActual':
        return this.sesionActual();
      default:
        return this.resumen(args);
    }
  }

  private async resumen(
    args: ConsultarCajaArgs,
  ): Promise<ConsultarCajaResultado> {
    if (!args.desde || !args.hasta) {
      throw new BadRequestException(
        'desde y hasta son requeridos para modo resumen.',
      );
    }
    const { gte: desde, lt: hasta } = rangoFecha(args.desde, args.hasta);

    const sesiones = await this.prisma.sesionCaja.findMany({
      where: { fecha: { gte: desde, lt: hasta } },
      select: {
        estado: true,
        montoInicial: true,
        movimientos: { select: { tipo: true, medio: true, importe: true } },
      },
    });

    const fondosDisponibles = await this.fondosDisponibles();

    if (sesiones.length === 0) {
      return {
        totalIngresos: 0,
        totalEgresos: 0,
        saldoNeto: 0,
        totalMontoInicial: 0,
        cantidadSesiones: 0,
        cantidadSesionesAbiertas: 0,
        cantidadSesionesCerradas: 0,
        fondosDisponibles,
        porMedioPago: { efectivo: 0, tarjeta: 0, transferencia: 0 },
        sinResultados: true,
        metricas: this.metricasResumen({
          totalIngresos: 0,
          totalEgresos: 0,
          saldoNeto: 0,
          cantidadSesiones: 0,
          cantidadSesionesAbiertas: 0,
          cantidadSesionesCerradas: 0,
          fondosDisponibles,
          porMedioPago: { efectivo: 0, tarjeta: 0, transferencia: 0 },
        }),
        columnas: [],
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const movimientos = sesiones.flatMap((s) => s.movimientos);
    const totalIngresos = movimientos
      .filter((m) => TIPOS_INGRESO.includes(m.tipo))
      .reduce((acc, m) => acc + Number(m.importe), 0);
    const totalEgresos = movimientos
      .filter((m) => m.tipo === TipoMovimientoCaja.EGRESO)
      .reduce((acc, m) => acc + Number(m.importe), 0);
    const totalMontoInicial = sesiones.reduce(
      (acc, s) => acc + Number(s.montoInicial),
      0,
    );
    const saldoNeto = totalIngresos - totalEgresos;
    const cantidadSesionesAbiertas = sesiones.filter(
      (s) => s.estado === EstadoSesionCaja.ABIERTA,
    ).length;
    const cantidadSesionesCerradas = sesiones.filter(
      (s) => s.estado === EstadoSesionCaja.CERRADA,
    ).length;
    const porMedioPago = this.calcularPorMedioPago(movimientos);

    return {
      totalIngresos,
      totalEgresos,
      saldoNeto,
      totalMontoInicial,
      cantidadSesiones: sesiones.length,
      cantidadSesionesAbiertas,
      cantidadSesionesCerradas,
      fondosDisponibles,
      porMedioPago,
      metricas: this.metricasResumen({
        totalIngresos,
        totalEgresos,
        saldoNeto,
        cantidadSesiones: sesiones.length,
        cantidadSesionesAbiertas,
        cantidadSesionesCerradas,
        fondosDisponibles,
        porMedioPago,
      }),
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** Agregados de `resumen`: aplana `fondosDisponibles`/`porMedioPago` en métricas planas. */
  private metricasResumen(datos: {
    totalIngresos: number;
    totalEgresos: number;
    saldoNeto: number;
    cantidadSesiones: number;
    cantidadSesionesAbiertas: number;
    cantidadSesionesCerradas: number;
    fondosDisponibles: FondosDisponiblesResultado;
    porMedioPago: PorMedioPagoDto;
  }) {
    return metricas(
      metrica('totalIngresos', 'Ingresos', datos.totalIngresos, 'currency'),
      metrica('totalEgresos', 'Egresos', datos.totalEgresos, 'currency'),
      metrica('saldoNeto', 'Saldo neto', datos.saldoNeto, 'currency'),
      metrica(
        'cantidadSesiones',
        'Sesiones',
        datos.cantidadSesiones,
        'number',
      ),
      metrica(
        'cantidadSesionesAbiertas',
        'Sesiones abiertas',
        datos.cantidadSesionesAbiertas,
        'number',
      ),
      metrica(
        'cantidadSesionesCerradas',
        'Sesiones cerradas',
        datos.cantidadSesionesCerradas,
        'number',
      ),
      metrica(
        'tesoreriaEfectivo',
        'Tesorería efectivo',
        datos.fondosDisponibles.tesoreriaEfectivo,
        'currency',
      ),
      metrica(
        'tesoreriaBanco',
        'Tesorería banco',
        datos.fondosDisponibles.tesoreriaBanco,
        'currency',
      ),
      metrica(
        'cajaDiariaDisponible',
        'Caja diaria disponible',
        datos.fondosDisponibles.cajaDiaria?.disponible ?? null,
        'currency',
      ),
      metrica('efectivo', 'Efectivo', datos.porMedioPago.efectivo, 'currency'),
      metrica('tarjeta', 'Tarjeta', datos.porMedioPago.tarjeta, 'currency'),
      metrica(
        'transferencia',
        'Transferencia',
        datos.porMedioPago.transferencia,
        'currency',
      ),
    );
  }

  /** K2 — desglose de ingresos de caja diaria por medio de pago. */
  private calcularPorMedioPago(
    movimientos: {
      tipo: TipoMovimientoCaja;
      medio: MedioPago | null;
      importe: Prisma.Decimal;
    }[],
  ): PorMedioPagoDto {
    const porMedio = (medio: MedioPago) =>
      movimientos
        .filter((m) => TIPOS_INGRESO.includes(m.tipo) && m.medio === medio)
        .reduce((acc, m) => acc + Number(m.importe), 0);
    return {
      efectivo: porMedio(MedioPago.EFECTIVO),
      tarjeta: porMedio(MedioPago.TARJETA),
      transferencia: porMedio(MedioPago.TRANSFERENCIA),
    };
  }

  /**
   * K1 — sin `sesionNumero`: listado de sesiones CERRADAS del rango (replica
   * `CajaService.historial()`). Con `sesionNumero`: detalle de esa sesión puntual dentro del
   * rango (replica `CajaService.detalleSesion()`, restringido a CERRADA) — puede haber más de
   * una sesión con el mismo `numero` en fechas distintas (`numero` es correlativo POR fecha,
   * no global), en cuyo caso se devuelve `ambiguo` en vez de elegir una arbitrariamente.
   */
  private async sesiones(
    args: ConsultarCajaArgs,
  ): Promise<ConsultarCajaResultado> {
    if (!args.desde || !args.hasta) {
      throw new BadRequestException(
        'desde y hasta son requeridos para modo sesiones.',
      );
    }
    const { gte, lt } = rangoFecha(args.desde, args.hasta);

    if (args.sesionNumero != null) {
      const candidatas = await this.prisma.sesionCaja.findMany({
        where: {
          numero: args.sesionNumero,
          estado: EstadoSesionCaja.CERRADA,
          fecha: { gte, lt },
        },
        include: { movimientos: true },
      });

      if (candidatas.length === 0) {
        return this.sinEntidades({ sesionNoEncontrada: true });
      }
      if (candidatas.length > 1) {
        return this.sinEntidades({
          ambiguo: true,
          candidatos: candidatas.map(
            (s) => `Sesión ${s.numero} del ${s.fecha.toISOString().slice(0, 10)}`,
          ),
        });
      }

      const sesion = candidatas[0];
      const mediosDePago = [
        ...new Set(
          sesion.movimientos
            .filter((m) => m.tipo === TipoMovimientoCaja.VENTA && m.medio)
            .map((m) => m.medio as MedioPago),
        ),
      ];
      const horaCierre = sesion.horaCierre
        ? sesion.horaCierre.toISOString()
        : null;
      const fila: Fila = {
        numero: sesion.numero,
        fecha: sesion.fecha.toISOString(),
        horaApertura: sesion.horaApertura.toISOString(),
        horaCierre,
      };

      return {
        sesionDetalle: {
          numero: sesion.numero,
          fecha: sesion.fecha.toISOString(),
          horaApertura: sesion.horaApertura.toISOString(),
          horaCierre,
          mediosDePago,
          movimientos: sesion.movimientos.map((m) => ({
            hora: m.hora.toISOString(),
            concepto: m.concepto,
            tipo: m.tipo,
            medio: m.medio,
            importe: Number(m.importe),
          })),
        },
        metricas: [],
        columnas: COLUMNAS_SESION_DETALLE,
        filas: [fila],
        metadata: metadata(1, 1),
      };
    }

    const sesiones = await this.prisma.sesionCaja.findMany({
      where: { estado: EstadoSesionCaja.CERRADA, fecha: { gte, lt } },
      include: { movimientos: { select: { tipo: true, importe: true } } },
      orderBy: [{ fecha: 'desc' }, { numero: 'desc' }],
    });

    if (sesiones.length === 0) {
      return {
        sesiones: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_SESIONES,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const filas = sesiones.map((s) => {
      const ingresos = s.movimientos
        .filter((m) => TIPOS_INGRESO.includes(m.tipo))
        .reduce((acc, m) => acc + Number(m.importe), 0);
      const egresos = s.movimientos
        .filter((m) => m.tipo === TipoMovimientoCaja.EGRESO)
        .reduce((acc, m) => acc + Number(m.importe), 0);
      return {
        numero: s.numero,
        fecha: s.fecha.toISOString(),
        horaApertura: s.horaApertura.toISOString(),
        horaCierre: s.horaCierre ? s.horaCierre.toISOString() : null,
        total: ingresos - egresos,
      };
    });

    const mostrado = filas.slice(0, LIMIT);

    return {
      sesiones: mostrado,
      total: filas.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_SESIONES,
      filas: mostrado,
      metadata: metadata(filas.length, mostrado.length),
    };
  }

  /** K5 — foto del estado ACTUAL: ¿hay una sesión de caja abierta ahora mismo? */
  private async sesionActual(): Promise<ConsultarCajaResultado> {
    const abierta = await this.prisma.sesionCaja.findFirst({
      where: { estado: EstadoSesionCaja.ABIERTA },
      select: { numero: true, horaApertura: true, montoInicial: true },
      orderBy: { horaApertura: 'desc' },
    });

    if (!abierta) {
      return this.sinEntidades({ hayCajaAbierta: false });
    }

    const horaApertura = abierta.horaApertura.toISOString();
    const montoInicial = Number(abierta.montoInicial);
    const fila: Fila = {
      numeroSesion: abierta.numero,
      horaApertura,
      montoInicial,
    };

    return {
      hayCajaAbierta: true,
      numeroSesion: abierta.numero,
      horaApertura,
      montoInicial,
      metricas: [],
      columnas: COLUMNAS_SESION_ACTUAL,
      filas: [fila],
      metadata: metadata(1, 1),
    };
  }

  /** Casos sin entidad resuelta (sesión no encontrada/ambigua, caja no abierta). */
  private sinEntidades(
    campos: Partial<ConsultarCajaResultado>,
  ): ConsultarCajaResultado {
    return {
      ...campos,
      metricas: [],
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  private async fondosDisponibles(): Promise<FondosDisponiblesResultado> {
    const sesionAbierta = await this.prisma.sesionCaja.findFirst({
      where: { estado: EstadoSesionCaja.ABIERTA },
      select: {
        id: true,
        movimientos: { select: { tipo: true, medio: true, importe: true } },
      },
      orderBy: { horaApertura: 'desc' },
    });

    const cajaDiaria = sesionAbierta
      ? {
          sesionId: sesionAbierta.id,
          disponible: this.efectivoDisponibleSesion(sesionAbierta.movimientos),
        }
      : null;

    const [tesoreriaEfectivo, tesoreriaBanco] = await Promise.all([
      this.saldoTesoreriaPorMedios([MedioPago.EFECTIVO]),
      this.saldoTesoreriaPorMedios(MEDIOS_BANCO),
    ]);

    return { cajaDiaria, tesoreriaEfectivo, tesoreriaBanco };
  }

  /** Mismo criterio que `CajaService.efectivoDisponibleSesion`: ventasEfectivo - egresos. */
  private efectivoDisponibleSesion(
    movimientos: {
      tipo: TipoMovimientoCaja;
      medio: MedioPago | null;
      importe: Prisma.Decimal;
    }[],
  ): number {
    const ventasEfectivo = movimientos
      .filter(
        (m) => TIPOS_INGRESO.includes(m.tipo) && m.medio === MedioPago.EFECTIVO,
      )
      .reduce((acc, m) => acc + Number(m.importe), 0);
    const egresos = movimientos
      .filter((m) => m.tipo === TipoMovimientoCaja.EGRESO)
      .reduce((acc, m) => acc + Number(m.importe), 0);
    return ventasEfectivo - egresos;
  }

  /** Mismo criterio que `CajaService.saldoTesoreriaPorMedios`: nunca incluye `medio: null`. */
  private async saldoTesoreriaPorMedios(medios: MedioPago[]): Promise<number> {
    const movimientos = await this.prisma.movimientoTesoreria.findMany({
      where: { medio: { in: medios } },
      select: { tipo: true, importe: true },
    });
    return movimientos.reduce(
      (acc, m) =>
        acc +
        (m.tipo === TipoMovimientoTesoreria.EGRESO ? -1 : 1) *
          Number(m.importe),
      0,
    );
  }
}
