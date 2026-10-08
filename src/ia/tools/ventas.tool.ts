import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FormaPagoVenta,
  ModalidadComercial,
  TipoCliente,
  UnidadProducto,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportesVentasService } from '../../reportes/reportes-ventas.service';
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

export type ModoConsultarVentas =
  | 'resumen'
  | 'ultimaVenta'
  | 'detalleVenta'
  | 'rankingProductos'
  | 'reporte'
  | 'comparativa';

const MODOS_VALIDOS: ModoConsultarVentas[] = [
  'resumen',
  'ultimaVenta',
  'detalleVenta',
  'rankingProductos',
  'reporte',
  'comparativa',
];

export interface ConsultarVentasArgs {
  desde: string;
  hasta: string;
  producto?: string | null;
  categoria?: string | null;
  proveedor?: string | null;
  tipoCliente?: string | null;
  formaPago?: string | null;
  /** Nombre del cliente (contains+insensitive) — filtro en `resumen`, target en `ultimaVenta`. */
  cliente?: string | null;
  modo?: ModoConsultarVentas | null;
  /** Requerido en `detalleVenta`: identifica la venta por su número, no por id interno. */
  ventaNumero?: number | null;
  /** Top N de `reporte` (V3) — sin este parámetro, `reporte` no incluye `topVentasCF`/`topVentasEMP`. */
  topN?: 5 | 10 | 20 | null;
}

export interface VentaClienteDto {
  ventaId: string;
  numero: number;
  fecha: string;
  total: number;
  formaPago: FormaPagoVenta;
}

export interface ItemVentaDetalleDto {
  productoNombre: string;
  modalidad: ModalidadComercial;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface ProductoRankingDto {
  productoNombre: string;
  cantidadVendida: number;
  importeTotal: number;
}

export interface TicketExtremoDto {
  numero: number;
  total: number;
}

export interface ClientePrincipalVentasDto {
  clienteId: string;
  nombre: string;
  total: number;
}

export interface ConsultarVentasResultado extends ResultadoPresentable {
  // modo 'resumen' (default, spec `compartido/17`/`18`)
  cantidadKg?: number;
  cantidadUnidades?: number;
  importeTotal?: number;
  lineas?: number;
  ventas?: number;
  ticketPromedio?: number;
  ticketPromedioParcial?: true;

  // modo 'ultimaVenta' (V1)
  clienteNoEncontrado?: true;
  ambiguo?: true;
  candidatos?: string[];
  nombre?: string;
  ventasCliente?: VentaClienteDto[];

  // modo 'detalleVenta' (V5)
  ventaNoEncontrada?: true;
  numero?: number;
  fecha?: string;
  clienteNombre?: string;
  totalVenta?: number;
  items?: ItemVentaDetalleDto[];

  // modo 'rankingProductos' (V6)
  ranking?: ProductoRankingDto[];

  // modo 'reporte' (V2 + V3)
  ticketMaximoCF?: TicketExtremoDto | null;
  ticketMinimoCF?: TicketExtremoDto | null;
  facturaMinimaEMP?: TicketExtremoDto | null;
  facturaMaximaEMP?: TicketExtremoDto | null;
  clientePrincipal?: ClientePrincipalVentasDto | null;
  topVentasCF?: TicketExtremoDto[];
  topVentasEMP?: TicketExtremoDto[];

  // modo 'comparativa' (V4)
  totalCF?: number;
  totalEMP?: number;
  totalGeneral?: number;
  diferencia?: number;
  pctCF?: number;
  pctEMP?: number;

  // campo compartido con `resumen`/`detalleVenta` (mismo dominio: forma de pago de la venta)
  formaPago?: FormaPagoVenta;

  // pagination de modos tabulares sin cota natural propia (`ultimaVenta`, `rankingProductos`)
  total?: number;
  limit?: number;
  sinResultados?: true;
}

const TIPOS_CLIENTE_VALIDOS = Object.values(TipoCliente);
const FORMAS_PAGO_VALIDAS = Object.values(FormaPagoVenta);

// Tope de filas tabulares (spec `compartido/19`): ninguna tool devuelve más de 50 registros.
const LIMIT = LIMITE_RESULTADOS;

const COLUMNAS_VENTAS_CLIENTE: Columna[] = [
  col.number('numero', 'Número'),
  col.date('fecha', 'Fecha'),
  col.currency('total', 'Total'),
  col.status('formaPago', 'Forma de pago'),
];

const COLUMNAS_DETALLE_VENTA: Columna[] = [
  col.number('numero', 'Número'),
  col.date('fecha', 'Fecha'),
  col.text('clienteNombre', 'Cliente'),
  col.currency('totalVenta', 'Total'),
  col.status('formaPago', 'Forma de pago'),
  col.number('cantidadItems', 'Cantidad de productos'),
];

const COLUMNAS_RANKING: Columna[] = [
  col.text('productoNombre', 'Producto'),
  col.number('cantidadVendida', 'Cantidad vendida'),
  col.currency('importeTotal', 'Importe'),
];

const COLUMNAS_TOP_VENTAS: Columna[] = [
  col.text('segmento', 'Segmento'),
  col.number('numero', 'Número'),
  col.currency('total', 'Total'),
];

/**
 * Tool `consultarVentas` (spec `compartido/17`, filtros/ticket promedio ampliados en
 * `compartido/18`, modos V1/V5/V6/V2/V3/V4 en `compartido/21`). `resumen` (default) es
 * lectura pura sobre `VentaItem`, sin lógica de negocio propia: `cantidadStock` ya viene
 * resuelta a unidad de stock por `calcularCantidadStock()` al confirmar la venta
 * (`ventas.service.ts`), acá solo se suma. Los modos `reporte`/`comparativa` reusan
 * `ReportesVentasService` en vez de duplicar sus cálculos (`cf()`/`emp()`/`comparativa()`).
 * `ultimaVenta`/`detalleVenta`/`rankingProductos` no tienen equivalente en `ReportesModule`:
 * Prisma directo, mismo patrón que el resto de las tools de `ia/`.
 *
 * Contrato de presentación (spec `compartido/22`): `resumen`/`comparativa` son agregados
 * puros. `ultimaVenta`/`detalleVenta`/`rankingProductos` listan entidades concretas, sin
 * métricas de relleno. `reporte` combina ambos: métricas para los extremos (ticket
 * máximo/mínimo, cliente principal) y, sólo si se pidió `topN`, una tabla con el Top N de
 * ambos segmentos (CF/EMP) — el contrato no admite dos arrays paralelos, así que se unifican
 * con una columna `segmento`.
 */
@Injectable()
export class VentasToolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportesVentas: ReportesVentasService,
  ) {}

  async ejecutar(args: ConsultarVentasArgs): Promise<ConsultarVentasResultado> {
    if (
      args.tipoCliente != null &&
      !TIPOS_CLIENTE_VALIDOS.includes(args.tipoCliente as TipoCliente)
    ) {
      throw new BadRequestException(
        `tipoCliente inválido: ${args.tipoCliente}`,
      );
    }
    if (
      args.formaPago != null &&
      !FORMAS_PAGO_VALIDAS.includes(args.formaPago as FormaPagoVenta)
    ) {
      throw new BadRequestException(`formaPago inválido: ${args.formaPago}`);
    }
    if (
      args.modo != null &&
      !MODOS_VALIDOS.includes(args.modo as ModoConsultarVentas)
    ) {
      throw new BadRequestException(`modo inválido: ${args.modo}`);
    }

    switch (args.modo) {
      case 'ultimaVenta':
        return this.ultimaVenta(args);
      case 'detalleVenta':
        return this.detalleVenta(args);
      case 'rankingProductos':
        return this.rankingProductos(args);
      case 'reporte':
        return this.reporte(args);
      case 'comparativa':
        return this.comparativa(args);
      default:
        return this.resumen(args);
    }
  }

  private async resumen(
    args: ConsultarVentasArgs,
  ): Promise<ConsultarVentasResultado> {
    const { gte: desde, lt: hasta } = rangoFecha(args.desde, args.hasta);
    const hayFiltroParcial = Boolean(
      args.producto || args.categoria || args.proveedor,
    );

    const items = await this.prisma.ventaItem.findMany({
      where: {
        venta: {
          fecha: { gte: desde, lt: hasta },
          ...(args.formaPago && {
            formaPago: args.formaPago as FormaPagoVenta,
          }),
          ...((args.tipoCliente || args.cliente) && {
            cliente: {
              ...(args.tipoCliente && { tipo: args.tipoCliente as TipoCliente }),
              ...(args.cliente && {
                nombre: { contains: args.cliente, mode: 'insensitive' },
              }),
            },
          }),
        },
        producto: {
          ...(args.producto && {
            nombre: { contains: args.producto, mode: 'insensitive' },
          }),
          ...(args.categoria && {
            categoria: {
              nombre: { contains: args.categoria, mode: 'insensitive' },
            },
          }),
          ...(args.proveedor && {
            proveedor: {
              nombre: { contains: args.proveedor, mode: 'insensitive' },
            },
          }),
        },
      },
      select: {
        ventaId: true,
        cantidadStock: true,
        subtotal: true,
        producto: { select: { unidad: true } },
      },
    });

    if (items.length === 0) {
      return {
        cantidadKg: 0,
        cantidadUnidades: 0,
        importeTotal: 0,
        lineas: 0,
        ventas: 0,
        ticketPromedio: 0,
        ...(hayFiltroParcial && { ticketPromedioParcial: true }),
        sinResultados: true,
        metricas: metricas(
          metrica('cantidadKg', 'Cantidad (kg)', 0, 'kg'),
          metrica('cantidadUnidades', 'Cantidad (un.)', 0, 'un'),
          metrica('importeTotal', 'Importe total', 0, 'currency'),
          metrica('ventas', 'Ventas', 0, 'number'),
          metrica('ticketPromedio', 'Ticket promedio', 0, 'currency'),
        ),
        columnas: [],
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const cantidadKg = items
      .filter((item) => item.producto.unidad === UnidadProducto.KG)
      .reduce((acc, item) => acc + Number(item.cantidadStock), 0);
    const cantidadUnidades = items
      .filter((item) => item.producto.unidad === UnidadProducto.UN)
      .reduce((acc, item) => acc + Number(item.cantidadStock), 0);
    const importeTotal = items.reduce(
      (acc, item) => acc + Number(item.subtotal),
      0,
    );
    const ventas = new Set(items.map((item) => item.ventaId)).size;
    const ticketPromedio = ventas === 0 ? 0 : importeTotal / ventas;

    return {
      cantidadKg,
      cantidadUnidades,
      importeTotal,
      lineas: items.length,
      ventas,
      ticketPromedio,
      ...(hayFiltroParcial && { ticketPromedioParcial: true }),
      metricas: metricas(
        metrica('cantidadKg', 'Cantidad (kg)', cantidadKg, 'kg'),
        metrica('cantidadUnidades', 'Cantidad (un.)', cantidadUnidades, 'un'),
        metrica('importeTotal', 'Importe total', importeTotal, 'currency'),
        metrica('ventas', 'Ventas', ventas, 'number'),
        metrica('ticketPromedio', 'Ticket promedio', ticketPromedio, 'currency'),
      ),
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** V1 — última venta / historial de un cliente puntual, con monto y forma de pago. */
  private async ultimaVenta(
    args: ConsultarVentasArgs,
  ): Promise<ConsultarVentasResultado> {
    if (!args.cliente) {
      throw new BadRequestException(
        'cliente es requerido para modo ultimaVenta.',
      );
    }
    const resuelto = await this.resolverCliente(args.cliente);
    if (resuelto.estado === 'no-encontrado') {
      return this.sinEntidades({ clienteNoEncontrado: true });
    }
    if (resuelto.estado === 'ambiguo') {
      return this.sinEntidades({
        ambiguo: true,
        candidatos: resuelto.candidatos,
      });
    }

    const { gte, lt } = rangoFecha(args.desde, args.hasta);
    const ventas = await this.prisma.venta.findMany({
      where: { clienteId: resuelto.id, fecha: { gte, lt } },
      orderBy: { fecha: 'desc' },
      select: {
        id: true,
        numero: true,
        fecha: true,
        total: true,
        formaPago: true,
      },
    });

    if (ventas.length === 0) {
      return {
        nombre: resuelto.nombre,
        ventasCliente: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_VENTAS_CLIENTE,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const detalle = ventas.slice(0, LIMIT).map((v) => ({
      ventaId: v.id,
      numero: v.numero,
      fecha: v.fecha.toISOString(),
      total: Number(v.total),
      formaPago: v.formaPago,
    }));

    return {
      nombre: resuelto.nombre,
      ventasCliente: detalle,
      total: ventas.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_VENTAS_CLIENTE,
      filas: detalle,
      metadata: metadata(ventas.length, detalle.length),
    };
  }

  /** V5 — detalle línea por línea de una venta puntual, identificada por número. */
  private async detalleVenta(
    args: ConsultarVentasArgs,
  ): Promise<ConsultarVentasResultado> {
    if (args.ventaNumero == null) {
      throw new BadRequestException(
        'ventaNumero es requerido para modo detalleVenta.',
      );
    }

    const venta = await this.prisma.venta.findUnique({
      where: { numero: args.ventaNumero },
      include: { cliente: true, items: { include: { producto: true } } },
    });
    if (!venta) return this.sinEntidades({ ventaNoEncontrada: true });

    const items = venta.items.map((item) => ({
      productoNombre: item.producto.nombre,
      modalidad: item.modalidad,
      cantidad: Number(item.cantidad),
      precioUnitario: Number(item.precioUnitario),
      subtotal: Number(item.subtotal),
    }));

    const fila: Fila = {
      numero: venta.numero,
      fecha: venta.fecha.toISOString(),
      clienteNombre: venta.cliente.nombre,
      formaPago: venta.formaPago,
      totalVenta: Number(venta.total),
      cantidadItems: items.length,
    };

    return {
      numero: venta.numero,
      fecha: venta.fecha.toISOString(),
      clienteNombre: venta.cliente.nombre,
      formaPago: venta.formaPago,
      totalVenta: Number(venta.total),
      items,
      metricas: [],
      columnas: COLUMNAS_DETALLE_VENTA,
      filas: [fila],
      metadata: metadata(1, 1),
    };
  }

  /** V6 — ranking de productos más vendidos por importe, en el rango dado. */
  private async rankingProductos(
    args: ConsultarVentasArgs,
  ): Promise<ConsultarVentasResultado> {
    const { gte, lt } = rangoFecha(args.desde, args.hasta);
    const filas = await this.prisma.ventaItem.groupBy({
      by: ['productoId'],
      where: { venta: { fecha: { gte, lt } } },
      _sum: { cantidadStock: true, subtotal: true },
    });

    if (filas.length === 0) {
      return {
        ranking: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_RANKING,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: filas.map((f) => f.productoId) } },
      select: { id: true, nombre: true },
    });
    const nombrePorId = new Map(productos.map((p) => [p.id, p.nombre]));

    const ranking = filas
      .map((f) => ({
        productoNombre: nombrePorId.get(f.productoId) ?? f.productoId,
        cantidadVendida: Number(f._sum.cantidadStock ?? 0),
        importeTotal: Number(f._sum.subtotal ?? 0),
      }))
      .sort((a, b) => b.importeTotal - a.importeTotal);

    const mostrado = ranking.slice(0, LIMIT);

    return {
      ranking: mostrado,
      total: ranking.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_RANKING,
      filas: mostrado,
      metadata: metadata(ranking.length, mostrado.length),
    };
  }

  /** V2 + V3 — reusa `ReportesVentasService.cf()`/`.emp()`: cliente principal, ranking del
   *  cliente (cuando `analisis=porCliente`), ticket máximo/mínimo y Top N por importe. */
  private async reporte(
    args: ConsultarVentasArgs,
  ): Promise<ConsultarVentasResultado> {
    const analisis = args.topN
      ? (`top${args.topN}` as 'top5' | 'top10' | 'top20')
      : ('todas' as const);

    const [cf, emp] = await Promise.all([
      this.reportesVentas.cf({ desde: args.desde, hasta: args.hasta, analisis }),
      this.reportesVentas.emp({
        desde: args.desde,
        hasta: args.hasta,
        analisis,
      }),
    ]);

    const sinDatos = cf.cantidadTickets === 0 && emp.cantidadFacturas === 0;

    const topVentasCF = args.topN
      ? cf.detalle.map((v) => ({ numero: v.numero, total: v.total }))
      : undefined;
    const topVentasEMP = args.topN
      ? emp.detalle.map((v) => ({ numero: v.numero, total: v.total }))
      : undefined;

    // El contrato no admite dos arrays paralelos: se unifican en una sola tabla con columna
    // `segmento`, en vez de perder uno de los dos Top N.
    const filas: Fila[] = args.topN
      ? [
          ...(topVentasCF ?? []).map((v) => ({ segmento: 'CF', ...v })),
          ...(topVentasEMP ?? []).map((v) => ({ segmento: 'EMPRESA', ...v })),
        ]
      : [];

    return {
      ticketMaximoCF: cf.ticketMaximo,
      ticketMinimoCF: cf.ticketMinimo,
      facturaMinimaEMP: emp.facturaMinima,
      facturaMaximaEMP: emp.facturaMaxima,
      clientePrincipal: emp.clientePrincipal,
      ...(args.topN && { topVentasCF, topVentasEMP }),
      ...(sinDatos && { sinResultados: true as const }),
      metricas: metricas(
        metrica(
          'ticketMaximoCF',
          'Ticket máximo (CF)',
          cf.ticketMaximo?.total ?? null,
          'currency',
        ),
        metrica(
          'ticketMinimoCF',
          'Ticket mínimo (CF)',
          cf.ticketMinimo?.total ?? null,
          'currency',
        ),
        metrica(
          'facturaMinimaEMP',
          'Factura mínima (EMP)',
          emp.facturaMinima?.total ?? null,
          'currency',
        ),
        metrica(
          'facturaMaximaEMP',
          'Factura máxima (EMP)',
          emp.facturaMaxima?.total ?? null,
          'currency',
        ),
        metrica(
          'clientePrincipal',
          'Cliente principal',
          emp.clientePrincipal?.nombre ?? null,
          'text',
        ),
        metrica(
          'clientePrincipalTotal',
          'Total cliente principal',
          emp.clientePrincipal?.total ?? null,
          'currency',
        ),
      ),
      columnas: args.topN ? COLUMNAS_TOP_VENTAS : [],
      filas,
      metadata: metadata(filas.length, filas.length),
    };
  }

  /** V4 — comparativa CF vs EMP con porcentaje de participación, reusando `comparativa()`. */
  private async comparativa(
    args: ConsultarVentasArgs,
  ): Promise<ConsultarVentasResultado> {
    const resultado = await this.reportesVentas.comparativa({
      desde: args.desde,
      hasta: args.hasta,
    });

    return {
      totalCF: resultado.totalCF,
      totalEMP: resultado.totalEMP,
      totalGeneral: resultado.totalGeneral,
      diferencia: resultado.diferencia,
      pctCF: resultado.pctCF,
      pctEMP: resultado.pctEMP,
      ...(resultado.totalGeneral === 0 && { sinResultados: true as const }),
      metricas: metricas(
        metrica('totalCF', 'Total CF', resultado.totalCF, 'currency'),
        metrica('totalEMP', 'Total EMP', resultado.totalEMP, 'currency'),
        metrica(
          'totalGeneral',
          'Total general',
          resultado.totalGeneral,
          'currency',
        ),
        metrica('diferencia', 'Diferencia', resultado.diferencia, 'currency'),
        metrica('pctCF', '% CF', resultado.pctCF, 'percent'),
        metrica('pctEMP', '% EMP', resultado.pctEMP, 'percent'),
      ),
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** Casos sin entidad resuelta (cliente/venta no encontrado, ambiguo): sin datos que listar. */
  private sinEntidades(
    campos: Partial<ConsultarVentasResultado>,
  ): ConsultarVentasResultado {
    return {
      ...campos,
      metricas: [],
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** Mismo criterio que `resolverCliente` de `estado-cuenta-cliente.graph.ts`: contains +
   *  insensitive, sin match = no encontrado, más de un match = ambiguo. */
  private async resolverCliente(nombre: string): Promise<
    | { estado: 'no-encontrado' }
    | { estado: 'ambiguo'; candidatos: string[] }
    | { estado: 'ok'; id: string; nombre: string }
  > {
    const candidatos = await this.prisma.cliente.findMany({
      where: { nombre: { contains: nombre, mode: 'insensitive' } },
      select: { id: true, nombre: true },
    });
    if (candidatos.length === 0) return { estado: 'no-encontrado' };
    if (candidatos.length > 1) {
      return {
        estado: 'ambiguo',
        candidatos: candidatos.map((c) => c.nombre),
      };
    }
    return { estado: 'ok', id: candidatos[0].id, nombre: candidatos[0].nombre };
  }
}
