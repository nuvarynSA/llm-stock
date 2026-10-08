import { BadRequestException, Injectable } from '@nestjs/common';
import { ModalidadComercial, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  col,
  Columna,
  Fila,
  LIMITE_RESULTADOS,
  metadata,
  ResultadoPresentable,
} from '../presentacion/presentacion';

export type ModoResumenProveedor = 'resumen' | 'ultimaOrden';

const MODOS_VALIDOS: ModoResumenProveedor[] = ['resumen', 'ultimaOrden'];

export interface ResumenProveedorArgs {
  proveedor?: string | null;
  desde?: string | null;
  hasta?: string | null;
  modo?: ModoResumenProveedor | null;
}

export interface ProveedorResumenDto {
  nombre: string;
  deuda: number;
  totalComprado: number;
  cantidadOrdenes: number;
  ultimaOrden: string | null;
}

export interface ItemOrdenDetalleDto {
  productoNombre: string;
  modalidad: ModalidadComercial;
  cantidadPedida: number;
  costoUnitario: number;
  subtotal: number;
}

export interface ResumenProveedorResultado extends ResultadoPresentable {
  // modo 'resumen' (default, Fase 1c)
  proveedores?: ProveedorResumenDto[];

  // modo 'ultimaOrden' (C1)
  proveedorNoEncontrado?: true;
  ambiguo?: true;
  candidatos?: string[];
  nombre?: string;
  numero?: number;
  fecha?: string;
  totalOrden?: number;
  items?: ItemOrdenDetalleDto[];

  // pagination del modo 'resumen'
  total?: number;
  limit?: number;
  sinResultados?: true;
}

// Tope de filas tabulares (spec `compartido/19`): ninguna tool devuelve más de 50 registros.
const LIMIT = LIMITE_RESULTADOS;

const COLUMNAS_PROVEEDORES: Columna[] = [
  col.text('nombre', 'Proveedor'),
  col.currency('deuda', 'Deuda'),
  col.currency('totalComprado', 'Total comprado'),
  col.number('cantidadOrdenes', 'Cantidad de órdenes'),
  col.date('ultimaOrden', 'Última orden'),
];

const COLUMNAS_ULTIMA_ORDEN: Columna[] = [
  col.number('numero', 'Número'),
  col.date('fecha', 'Fecha'),
  col.currency('totalOrden', 'Total'),
  col.number('cantidadItems', 'Cantidad de productos'),
];

/**
 * Tool `resumenProveedor` (Fase 1c, modo `ultimaOrden` — C1 — en `compartido/21`). `resumen`
 * (default) sin equivalente previo en `reportes/`: `deuda` sale de `Proveedor.deuda` (columna
 * persistida), `totalComprado` = Σ(orden.cantidadPedida × costoUnitario) por orden en el
 * período — `OrdenCompra` no tiene columna `total`, mismo criterio que
 * `ReportesComprasService.totalOrden` / `OrdenesService.calcularTotal`. `ultimaOrden` replica
 * `OrdenesService.obtenerUno()` (monto + detalle de UNA orden) con Prisma directo: ese service
 * inyecta `CajaService`, bloqueado por el ciclo `CajaModule ↔ VentasModule ↔ ComprasModule`.
 */
@Injectable()
export class ResumenProveedorToolService {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    args: ResumenProveedorArgs,
  ): Promise<ResumenProveedorResultado> {
    if (
      args.modo != null &&
      !MODOS_VALIDOS.includes(args.modo as ModoResumenProveedor)
    ) {
      throw new BadRequestException(`modo inválido: ${args.modo}`);
    }

    if (args.modo === 'ultimaOrden') {
      return this.ultimaOrden(args);
    }
    return this.resumen(args);
  }

  private async resumen(
    args: ResumenProveedorArgs,
  ): Promise<ResumenProveedorResultado> {
    const fecha = this.rangoFecha(args);

    const proveedores = await this.prisma.proveedor.findMany({
      where: {
        ...(args.proveedor && {
          nombre: { contains: args.proveedor, mode: 'insensitive' },
        }),
      },
      select: { id: true, nombre: true, deuda: true },
    });

    if (proveedores.length === 0) {
      return {
        proveedores: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_PROVEEDORES,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const ordenes = await this.prisma.ordenCompra.findMany({
      where: {
        proveedorId: { in: proveedores.map((p) => p.id) },
        ...(fecha && { fecha }),
      },
      select: {
        proveedorId: true,
        fecha: true,
        items: { select: { cantidadPedida: true, costoUnitario: true } },
      },
    });

    const porProveedor = new Map<
      string,
      { totalComprado: number; cantidadOrdenes: number; ultimaOrden: Date }
    >();
    for (const o of ordenes) {
      const acc = porProveedor.get(o.proveedorId);
      const totalOrden = this.totalOrden(o.items);
      if (!acc) {
        porProveedor.set(o.proveedorId, {
          totalComprado: totalOrden,
          cantidadOrdenes: 1,
          ultimaOrden: o.fecha,
        });
      } else {
        acc.totalComprado += totalOrden;
        acc.cantidadOrdenes += 1;
        if (o.fecha > acc.ultimaOrden) acc.ultimaOrden = o.fecha;
      }
    }

    const detalle: ProveedorResumenDto[] = proveedores.map((p) => {
      const datos = porProveedor.get(p.id);
      return {
        nombre: p.nombre,
        deuda: Number(p.deuda),
        totalComprado: datos?.totalComprado ?? 0,
        cantidadOrdenes: datos?.cantidadOrdenes ?? 0,
        ultimaOrden: datos?.ultimaOrden.toISOString() ?? null,
      };
    });

    const mostrado = detalle.slice(0, LIMIT);

    return {
      proveedores: mostrado,
      total: detalle.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_PROVEEDORES,
      filas: mostrado.map((p) => ({ ...p })),
      metadata: metadata(detalle.length, mostrado.length),
    };
  }

  /** C1 — última orden de UN proveedor puntual, con monto total y detalle línea por línea. */
  private async ultimaOrden(
    args: ResumenProveedorArgs,
  ): Promise<ResumenProveedorResultado> {
    if (!args.proveedor) {
      throw new BadRequestException(
        'proveedor es requerido para modo ultimaOrden.',
      );
    }
    const resuelto = await this.resolverProveedor(args.proveedor);
    if (resuelto.estado === 'no-encontrado') {
      return this.sinEntidades({ proveedorNoEncontrado: true });
    }
    if (resuelto.estado === 'ambiguo') {
      return this.sinEntidades({
        ambiguo: true,
        candidatos: resuelto.candidatos,
      });
    }

    const orden = await this.prisma.ordenCompra.findFirst({
      where: { proveedorId: resuelto.id },
      orderBy: { fecha: 'desc' },
      include: { items: { include: { producto: true } } },
    });

    if (!orden) {
      return this.sinEntidades({ nombre: resuelto.nombre, sinResultados: true });
    }

    const totalOrden = this.totalOrden(orden.items);
    const items = orden.items.map((item) => ({
      productoNombre: item.producto.nombre,
      modalidad: item.modalidad,
      cantidadPedida: Number(item.cantidadPedida),
      costoUnitario: Number(item.costoUnitario),
      subtotal: new Prisma.Decimal(item.cantidadPedida)
        .mul(item.costoUnitario)
        .toNumber(),
    }));
    const fila: Fila = {
      numero: orden.numero,
      fecha: orden.fecha.toISOString(),
      totalOrden,
      cantidadItems: items.length,
    };

    return {
      nombre: resuelto.nombre,
      numero: orden.numero,
      fecha: orden.fecha.toISOString(),
      totalOrden,
      items,
      metricas: [],
      columnas: COLUMNAS_ULTIMA_ORDEN,
      filas: [fila],
      metadata: metadata(1, 1),
    };
  }

  /** Casos sin entidad resuelta (proveedor no encontrado, ambiguo, sin órdenes). */
  private sinEntidades(
    campos: Partial<ResumenProveedorResultado>,
  ): ResumenProveedorResultado {
    return {
      ...campos,
      metricas: [],
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** Mismo criterio que `resolverCliente` de `ventas.tool.ts`: contains + insensitive, sin
   *  match = no encontrado, más de un match = ambiguo. */
  private async resolverProveedor(nombre: string): Promise<
    | { estado: 'no-encontrado' }
    | { estado: 'ambiguo'; candidatos: string[] }
    | { estado: 'ok'; id: string; nombre: string }
  > {
    const candidatos = await this.prisma.proveedor.findMany({
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

  private rangoFecha(
    args: ResumenProveedorArgs,
  ): { gte: Date; lt: Date } | undefined {
    if (!args.desde || !args.hasta) return undefined;
    return {
      gte: new Date(args.desde),
      lt: new Date(new Date(args.hasta).getTime() + 24 * 60 * 60 * 1000),
    };
  }
}
