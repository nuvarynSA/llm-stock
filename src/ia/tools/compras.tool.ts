import { BadRequestException, Injectable } from '@nestjs/common';
import { ModalidadComercial, Prisma, UnidadProducto } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportesComprasService } from '../../reportes/reportes-compras.service';
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

export type ModoConsultarCompras =
  | 'resumen'
  | 'ordenes'
  | 'comparativa'
  | 'precioProveedor';

const MODOS_VALIDOS: ModoConsultarCompras[] = [
  'resumen',
  'ordenes',
  'comparativa',
  'precioProveedor',
];

type EstadoPagoFiltro = 'todos' | 'pendiente' | 'pagada';
type EstadoRecepcionFiltro = 'todos' | 'pendiente' | 'parcial' | 'recibida';

const ESTADOS_PAGO_VALIDOS: EstadoPagoFiltro[] = [
  'todos',
  'pendiente',
  'pagada',
];
const ESTADOS_RECEPCION_VALIDOS: EstadoRecepcionFiltro[] = [
  'todos',
  'pendiente',
  'parcial',
  'recibida',
];

export interface ConsultarComprasArgs {
  desde: string;
  hasta: string;
  producto?: string | null;
  categoria?: string | null;
  proveedor?: string | null;
  modo?: ModoConsultarCompras | null;
  /** Requerido junto con `modo: 'ordenes'` (C2) para filtrar por estado de pago. */
  estadoPago?: EstadoPagoFiltro | null;
  /** Requerido junto con `modo: 'ordenes'` (C2) para filtrar por estado de recepción. */
  estadoRecepcion?: EstadoRecepcionFiltro | null;
}

export interface OrdenCompraResumenDto {
  numero: number;
  proveedorNombre: string;
  fecha: string;
  total: number;
  estadoPago: 'pendiente' | 'pagada';
  estadoRecepcion: 'pendiente' | 'parcial' | 'recibida';
}

export interface PrecioProveedorDto {
  proveedorNombre: string;
  productoNombre: string;
  modalidad: ModalidadComercial;
  precio: number;
}

export interface ConsultarComprasResultado extends ResultadoPresentable {
  // modo 'resumen' (default, spec `compartido/17`)
  totalComprado?: number;
  cantidadRecibidaKg?: number;
  cantidadRecibidaUnidades?: number;
  lineas?: number;

  // modo 'ordenes' (C2)
  ordenes?: OrdenCompraResumenDto[];

  // modo 'comparativa' (C3)
  totalCompras?: number;
  totalGastos?: number;
  totalGeneral?: number;
  diferencia?: number;
  pctCompras?: number;
  pctGastos?: number;

  // modo 'precioProveedor' (C4)
  precios?: PrecioProveedorDto[];

  // pagination de modos tabulares (`ordenes`, `precioProveedor`)
  total?: number;
  limit?: number;
  sinResultados?: true;
}

// Tope de filas tabulares (spec `compartido/19`): ninguna tool devuelve más de 50 registros.
const LIMIT = LIMITE_RESULTADOS;

const COLUMNAS_ORDENES: Columna[] = [
  col.number('numero', 'Número'),
  col.text('proveedorNombre', 'Proveedor'),
  col.date('fecha', 'Fecha'),
  col.currency('total', 'Total'),
  col.status('estadoPago', 'Estado de pago'),
  col.status('estadoRecepcion', 'Estado de recepción'),
];

const COLUMNAS_PRECIO_PROVEEDOR: Columna[] = [
  col.text('proveedorNombre', 'Proveedor'),
  col.text('productoNombre', 'Producto'),
  col.text('modalidad', 'Modalidad'),
  col.currency('precio', 'Precio'),
];

/**
 * Tool `consultarCompras` (spec `compartido/17`, modos C2/C3/C4 en `compartido/21`).
 * `resumen` (default) es lectura pura sobre `OrdenCompraItem`, sin lógica de negocio propia:
 * `totalComprado` = Σ(cantidadPedida × costoUnitario), mismo cálculo que
 * `OrdenesService.calcularTotal` (`ordenes.service.ts:694`) porque `OrdenCompra` no tiene
 * columna `total`. `cantidadRecibida*` usa `cantidadStockRecibida`, que ya viene en unidad de
 * stock (reglaNegocio48) — no se reconvierte. `ordenes` (C2) replica
 * `OrdenesService.conEstadosDerivados()` con Prisma directo — ese service inyecta `CajaService`,
 * bloqueado por el ciclo `CajaModule ↔ VentasModule ↔ ComprasModule`. `comparativa` (C3) reusa
 * `ReportesComprasService.comparativa()` en vez de duplicarlo. `precioProveedor` (C4) es Prisma
 * directo sobre `PrecioProveedor`, sin equivalente previo en `ReportesModule`.
 *
 * Contrato de presentación (spec `compartido/22`): `resumen`/`comparativa` son agregados puros
 * (sin `filas` — la pregunta no pide entidades concretas), `ordenes`/`precioProveedor` listan
 * entidades y NO emiten métricas de relleno (ninguna respondía "qué órdenes hice" — es la causa
 * raíz del bug reportado).
 */
@Injectable()
export class ComprasToolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportesCompras: ReportesComprasService,
  ) {}

  async ejecutar(
    args: ConsultarComprasArgs,
  ): Promise<ConsultarComprasResultado> {
    if (
      args.modo != null &&
      !MODOS_VALIDOS.includes(args.modo as ModoConsultarCompras)
    ) {
      throw new BadRequestException(`modo inválido: ${args.modo}`);
    }
    if (
      args.estadoPago != null &&
      !ESTADOS_PAGO_VALIDOS.includes(args.estadoPago as EstadoPagoFiltro)
    ) {
      throw new BadRequestException(`estadoPago inválido: ${args.estadoPago}`);
    }
    if (
      args.estadoRecepcion != null &&
      !ESTADOS_RECEPCION_VALIDOS.includes(
        args.estadoRecepcion as EstadoRecepcionFiltro,
      )
    ) {
      throw new BadRequestException(
        `estadoRecepcion inválido: ${args.estadoRecepcion}`,
      );
    }

    switch (args.modo) {
      case 'ordenes':
        return this.ordenes(args);
      case 'comparativa':
        return this.comparativa(args);
      case 'precioProveedor':
        return this.precioProveedor(args);
      default:
        return this.resumen(args);
    }
  }

  private async resumen(
    args: ConsultarComprasArgs,
  ): Promise<ConsultarComprasResultado> {
    const { gte: desde, lt: hasta } = rangoFecha(args.desde, args.hasta);

    const items = await this.prisma.ordenCompraItem.findMany({
      where: {
        orden: { fecha: { gte: desde, lt: hasta } },
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
        cantidadPedida: true,
        costoUnitario: true,
        cantidadStockRecibida: true,
        producto: { select: { unidad: true } },
      },
    });

    if (items.length === 0) {
      return {
        totalComprado: 0,
        cantidadRecibidaKg: 0,
        cantidadRecibidaUnidades: 0,
        lineas: 0,
        sinResultados: true,
        metricas: metricas(
          metrica('totalComprado', 'Total comprado', 0, 'currency'),
          metrica('cantidadRecibidaKg', 'Cantidad recibida (kg)', 0, 'kg'),
          metrica(
            'cantidadRecibidaUnidades',
            'Cantidad recibida (un.)',
            0,
            'un',
          ),
          metrica('lineas', 'Líneas', 0, 'number'),
        ),
        columnas: [],
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const totalComprado = items
      .reduce(
        (acc, item) =>
          acc.add(
            new Prisma.Decimal(item.cantidadPedida).mul(item.costoUnitario),
          ),
        new Prisma.Decimal(0),
      )
      .toNumber();

    const cantidadRecibidaKg = items
      .filter((item) => item.producto.unidad === UnidadProducto.KG)
      .reduce((acc, item) => acc + Number(item.cantidadStockRecibida), 0);
    const cantidadRecibidaUnidades = items
      .filter((item) => item.producto.unidad === UnidadProducto.UN)
      .reduce((acc, item) => acc + Number(item.cantidadStockRecibida), 0);

    return {
      totalComprado,
      cantidadRecibidaKg,
      cantidadRecibidaUnidades,
      lineas: items.length,
      metricas: metricas(
        metrica('totalComprado', 'Total comprado', totalComprado, 'currency'),
        metrica(
          'cantidadRecibidaKg',
          'Cantidad recibida (kg)',
          cantidadRecibidaKg,
          'kg',
        ),
        metrica(
          'cantidadRecibidaUnidades',
          'Cantidad recibida (un.)',
          cantidadRecibidaUnidades,
          'un',
        ),
        metrica('lineas', 'Líneas', items.length, 'number'),
      ),
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** C2 — órdenes filtradas por proveedor/rango/estado de pago/estado de recepción. */
  private async ordenes(
    args: ConsultarComprasArgs,
  ): Promise<ConsultarComprasResultado> {
    const { gte, lt } = rangoFecha(args.desde, args.hasta);

    const ordenes = await this.prisma.ordenCompra.findMany({
      where: {
        fecha: { gte, lt },
        ...(args.proveedor && {
          proveedor: {
            nombre: { contains: args.proveedor, mode: 'insensitive' },
          },
        }),
      },
      include: { proveedor: true, items: true },
      orderBy: { fecha: 'desc' },
    });

    const filas = ordenes
      .map((orden) => {
        const total = this.totalOrden(orden.items);
        const estadoPago: 'pendiente' | 'pagada' =
          total > 0 && orden.montoPagado.toNumber() >= total
            ? 'pagada'
            : 'pendiente';
        const totalPedido = orden.items.reduce(
          (acc, item) => acc + Number(item.cantidadPedida),
          0,
        );
        const totalRecibido = orden.items.reduce(
          (acc, item) => acc + Number(item.cantidadRecibida),
          0,
        );
        const estadoRecepcion: 'pendiente' | 'parcial' | 'recibida' =
          totalRecibido <= 0
            ? 'pendiente'
            : totalRecibido >= totalPedido
              ? 'recibida'
              : 'parcial';

        return {
          numero: orden.numero,
          proveedorNombre: orden.proveedor.nombre,
          fecha: orden.fecha.toISOString(),
          total,
          estadoPago,
          estadoRecepcion,
        };
      })
      .filter((orden) => {
        if (
          args.estadoPago &&
          args.estadoPago !== 'todos' &&
          orden.estadoPago !== args.estadoPago
        )
          return false;
        if (
          args.estadoRecepcion &&
          args.estadoRecepcion !== 'todos' &&
          orden.estadoRecepcion !== args.estadoRecepcion
        )
          return false;
        return true;
      });

    if (filas.length === 0) {
      return {
        ordenes: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_ORDENES,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const mostradas = filas.slice(0, LIMIT);

    return {
      ordenes: mostradas,
      total: filas.length,
      limit: LIMIT,
      // Sin métricas: ninguna responde "qué órdenes hice" (causa raíz del bug reportado,
      // spec `compartido/22`) — la tabla ya muestra proveedor/fecha/total/estados.
      metricas: [],
      columnas: COLUMNAS_ORDENES,
      filas: mostradas,
      metadata: metadata(filas.length, mostradas.length),
    };
  }

  /** C3 — gastos operativos vs mercadería, reusando `ReportesComprasService.comparativa()`. */
  private async comparativa(
    args: ConsultarComprasArgs,
  ): Promise<ConsultarComprasResultado> {
    const resultado = await this.reportesCompras.comparativa({
      desde: args.desde,
      hasta: args.hasta,
    });

    return {
      totalCompras: resultado.totalCompras,
      totalGastos: resultado.totalGastos,
      totalGeneral: resultado.totalGeneral,
      diferencia: resultado.diferencia,
      pctCompras: resultado.pctCompras,
      pctGastos: resultado.pctGastos,
      ...(resultado.totalGeneral === 0 && { sinResultados: true as const }),
      metricas: metricas(
        metrica(
          'totalCompras',
          'Total compras',
          resultado.totalCompras,
          'currency',
        ),
        metrica(
          'totalGastos',
          'Total gastos',
          resultado.totalGastos,
          'currency',
        ),
        metrica(
          'totalGeneral',
          'Total general',
          resultado.totalGeneral,
          'currency',
        ),
        metrica('diferencia', 'Diferencia', resultado.diferencia, 'currency'),
        metrica('pctCompras', '% Compras', resultado.pctCompras, 'percent'),
        metrica('pctGastos', '% Gastos', resultado.pctGastos, 'percent'),
      ),
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** C4 — precio de un producto por proveedor, ordenado de menor a mayor para comparar. */
  private async precioProveedor(
    args: ConsultarComprasArgs,
  ): Promise<ConsultarComprasResultado> {
    if (!args.producto) {
      throw new BadRequestException(
        'producto es requerido para modo precioProveedor.',
      );
    }

    const precios = await this.prisma.precioProveedor.findMany({
      where: {
        producto: { nombre: { contains: args.producto, mode: 'insensitive' } },
        ...(args.proveedor && {
          proveedor: {
            nombre: { contains: args.proveedor, mode: 'insensitive' },
          },
        }),
      },
      include: { proveedor: true, producto: true },
      orderBy: { precio: 'asc' },
    });

    if (precios.length === 0) {
      return {
        precios: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_PRECIO_PROVEEDOR,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const detalle = precios.slice(0, LIMIT).map((p) => ({
      proveedorNombre: p.proveedor.nombre,
      productoNombre: p.producto.nombre,
      modalidad: p.modalidad,
      precio: Number(p.precio),
    }));

    return {
      precios: detalle,
      total: precios.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_PRECIO_PROVEEDOR,
      filas: detalle,
      metadata: metadata(precios.length, detalle.length),
    };
  }

  /** Mismo cálculo que `OrdenesService.calcularTotal`/`ResumenProveedorToolService.totalOrden`. */
  private totalOrden(
    items: { cantidadPedida: Prisma.Decimal; costoUnitario: Prisma.Decimal }[],
  ): number {
    return items
      .reduce(
        (acc, item) =>
          acc.add(
            new Prisma.Decimal(item.cantidadPedida).mul(item.costoUnitario),
          ),
        new Prisma.Decimal(0),
      )
      .toNumber();
  }
}
