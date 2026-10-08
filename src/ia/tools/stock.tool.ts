import { BadRequestException, Injectable } from '@nestjs/common';
import {
  OrigenMovimientoStock,
  TipoMovimientoStock,
  UnidadProducto,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportesStockService } from '../../reportes/reportes-stock.service';
import {
  col,
  Columna,
  LIMITE_RESULTADOS,
  metadata,
  metrica,
  metricas,
  ResultadoPresentable,
} from '../presentacion/presentacion';

export type ModoConsultarStock =
  | 'resumen'
  | 'historial'
  | 'porEstado'
  | 'categorias'
  | 'rotacion';

const MODOS_VALIDOS: ModoConsultarStock[] = [
  'resumen',
  'historial',
  'porEstado',
  'categorias',
  'rotacion',
];

export interface ConsultarStockArgs {
  producto?: string | null;
  categoria?: string | null;
  proveedor?: string | null;
  modo?: ModoConsultarStock | null;
  /** Usado en modo `historial` (filtro opcional, S1) y `rotacion` (requerido, S5). */
  desde?: string | null;
  hasta?: string | null;
}

export interface ProductoStockDto {
  nombre: string;
  unidad: UnidadProducto;
  categoriaNombre: string | null;
  proveedorNombre: string | null;
  stockActual: number;
  stockCritico: number;
  bajoStockCritico: boolean;
}

export interface MovimientoStockDto {
  fecha: string;
  tipo: TipoMovimientoStock;
  origen: OrigenMovimientoStock;
  comprobante: string | null;
  cantidad: number;
  stockFinal: number;
}

export interface CategoriaConteoDto {
  categoriaNombre: string;
  cantidadProductos: number;
}

export interface RotacionProductoDto {
  productoNombre: string;
  cantidadMovimientos: number;
}

export interface ConsultarStockResultado extends ResultadoPresentable {
  // modo 'resumen' (default, spec `compartido/17`)
  productos?: ProductoStockDto[];
  cantidadBajoStockCritico?: number;

  // modo 'historial' (S1)
  productoNoEncontrado?: true;
  ambiguo?: true;
  candidatos?: string[];
  nombreProducto?: string;
  movimientos?: MovimientoStockDto[];

  // modo 'porEstado' (S3)
  totalProductos?: number;
  normales?: number;
  criticos?: number;
  pctNormal?: number;
  pctCritico?: number;

  // modo 'categorias' (S4)
  categorias?: CategoriaConteoDto[];

  // modo 'rotacion' (S5)
  rotacion?: RotacionProductoDto[];

  // pagination de modos tabulares (`historial`, `categorias`, `rotacion`)
  total?: number;
  limit?: number;
  sinResultados?: true;
}

// Tope de filas tabulares (spec `compartido/19`, ampliación 2026-09-08): ninguna tool
// devuelve más de 50 registros. La query de Prisma NO se corta con esto — sólo el array
// final `productos`, después de calcular `cantidadBajoStockCritico` sobre el total real.
const LIMIT = LIMITE_RESULTADOS;

const COLUMNAS_PRODUCTOS: Columna[] = [
  col.text('nombre', 'Producto'),
  col.text('categoriaNombre', 'Categoría'),
  col.text('proveedorNombre', 'Proveedor'),
  col.number('stockActual', 'Stock actual'),
  col.number('stockCritico', 'Stock crítico'),
  col.status('bajoStockCritico', 'Bajo crítico'),
];

const COLUMNAS_MOVIMIENTOS: Columna[] = [
  col.date('fecha', 'Fecha'),
  col.status('tipo', 'Tipo'),
  col.text('origen', 'Origen'),
  col.text('comprobante', 'Comprobante'),
  col.number('cantidad', 'Cantidad'),
  col.number('stockFinal', 'Stock final'),
];

const COLUMNAS_CATEGORIAS: Columna[] = [
  col.text('categoriaNombre', 'Categoría'),
  col.number('cantidadProductos', 'Cantidad de productos'),
];

const COLUMNAS_ROTACION: Columna[] = [
  col.text('productoNombre', 'Producto'),
  col.number('cantidadMovimientos', 'Movimientos'),
];

/**
 * Tool `consultarStock` (spec `compartido/17`, modos S1/S3/S4/S5 en `compartido/21`).
 * `resumen` (default) — foto del presente, sin rango de fechas. `bajoStockCritico` usa el
 * mismo criterio que `ReportesStockService.estado` (`stockActual < stockCritico`).
 *
 * `historial` (S1) replica `StockService.historial()` con Prisma directo en vez de importar
 * `StockModule`: aunque `StockModule` está fuera del ciclo `CajaModule ↔ VentasModule ↔
 * ComprasModule` (no tiene `forwardRef`, solo depende de `PrismaService`), su único método
 * de historial recibe `productoId`, no nombre — de cualquier forma hace falta resolver el
 * producto por nombre acá mismo (mismo patrón que `resolverCliente` en `ventas.tool.ts`), así
 * que importar el módulo solo para reusar el `findMany` no suma nada frente a Prisma directo,
 * que es además el patrón ya vigente en el resto de este archivo (el propio modo `resumen`
 * nunca usó `StockService`).
 *
 * `porEstado` (S3) reusa `ReportesStockService.estado()` en vez de duplicarlo.
 *
 * Contrato de presentación (spec `compartido/22`): `resumen`, `historial`, `categorias` y
 * `rotacion` listan entidades concretas — sin métricas de relleno, salvo
 * `cantidadBajoStockCritico` en `resumen` (responde directamente "¿cuántos productos están en
 * crítico?"). `porEstado` es un agregado puro.
 */
@Injectable()
export class StockToolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportesStock: ReportesStockService,
  ) {}

  async ejecutar(args: ConsultarStockArgs): Promise<ConsultarStockResultado> {
    if (
      args.modo != null &&
      !MODOS_VALIDOS.includes(args.modo as ModoConsultarStock)
    ) {
      throw new BadRequestException(`modo inválido: ${args.modo}`);
    }

    switch (args.modo) {
      case 'historial':
        return this.historial(args);
      case 'porEstado':
        return this.porEstado(args);
      case 'categorias':
        return this.categorias();
      case 'rotacion':
        return this.rotacion(args);
      default:
        return this.resumen(args);
    }
  }

  private async resumen(
    args: ConsultarStockArgs,
  ): Promise<ConsultarStockResultado> {
    const productos = await this.prisma.producto.findMany({
      where: {
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
      select: {
        nombre: true,
        unidad: true,
        stockActual: true,
        stockCritico: true,
        categoria: { select: { nombre: true } },
        proveedor: { select: { nombre: true } },
      },
    });

    if (productos.length === 0) {
      return {
        productos: [],
        total: 0,
        limit: LIMIT,
        cantidadBajoStockCritico: 0,
        sinResultados: true,
        metricas: metricas(
          metrica('cantidadBajoStockCritico', 'Bajo crítico', 0, 'number'),
        ),
        columnas: COLUMNAS_PRODUCTOS,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const detalle = productos.map((p) => ({
      nombre: p.nombre,
      unidad: p.unidad,
      categoriaNombre: p.categoria?.nombre ?? null,
      proveedorNombre: p.proveedor?.nombre ?? null,
      stockActual: Number(p.stockActual),
      stockCritico: Number(p.stockCritico),
      bajoStockCritico: Number(p.stockActual) < Number(p.stockCritico),
    }));

    // Ordena los críticos primero (sort estable, no reordena entre iguales) para no
    // perder ninguno al cortar a `LIMIT` — el conteo de abajo sigue sobre `detalle`
    // completo, no sobre este recorte.
    const ordenado = [...detalle].sort(
      (a, b) => Number(b.bajoStockCritico) - Number(a.bajoStockCritico),
    );
    const mostrado = ordenado.slice(0, LIMIT);
    const cantidadBajoStockCritico = detalle.filter(
      (p) => p.bajoStockCritico,
    ).length;

    return {
      productos: mostrado,
      total: detalle.length,
      limit: LIMIT,
      cantidadBajoStockCritico,
      metricas: metricas(
        metrica(
          'cantidadBajoStockCritico',
          'Bajo crítico',
          cantidadBajoStockCritico,
          'number',
        ),
      ),
      columnas: COLUMNAS_PRODUCTOS,
      filas: mostrado,
      metadata: metadata(detalle.length, mostrado.length),
    };
  }

  /** S1 — historial de movimientos de UN producto puntual, filtrable por rango de fechas. */
  private async historial(
    args: ConsultarStockArgs,
  ): Promise<ConsultarStockResultado> {
    if (!args.producto) {
      throw new BadRequestException(
        'producto es requerido para modo historial.',
      );
    }

    const resuelto = await this.resolverProducto(args.producto);
    if (resuelto.estado === 'no-encontrado') {
      return this.sinEntidades({ productoNoEncontrado: true });
    }
    if (resuelto.estado === 'ambiguo') {
      return this.sinEntidades({
        ambiguo: true,
        candidatos: resuelto.candidatos,
      });
    }

    // `hasta` inclusive del día completo (mismo criterio que `StockService.historial`,
    // no el helper `rangoFecha` porque acá, a diferencia del resto de las tools, desde/hasta
    // son opcionales de forma independiente entre sí).
    const movimientos = await this.prisma.movimientoStock.findMany({
      where: {
        productoId: resuelto.id,
        fecha: {
          gte: args.desde ? new Date(args.desde) : undefined,
          lt: args.hasta
            ? new Date(new Date(args.hasta).getTime() + 24 * 60 * 60 * 1000)
            : undefined,
        },
      },
      orderBy: { fecha: 'desc' },
    });

    if (movimientos.length === 0) {
      return {
        nombreProducto: resuelto.nombre,
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
      tipo: m.tipo,
      origen: m.origen,
      comprobante: m.comprobante,
      cantidad: Number(m.cantidad),
      stockFinal: Number(m.stockFinal),
    }));

    return {
      nombreProducto: resuelto.nombre,
      movimientos: detalle,
      total: movimientos.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_MOVIMIENTOS,
      filas: detalle,
      metadata: metadata(movimientos.length, detalle.length),
    };
  }

  /** S3 — % del catálogo en crítico vs. normal, reusando `ReportesStockService.estado()`. */
  private async porEstado(
    args: ConsultarStockArgs,
  ): Promise<ConsultarStockResultado> {
    const [categoriaId, proveedorId] = await Promise.all([
      this.resolverId('categoria', args.categoria),
      this.resolverId('proveedor', args.proveedor),
    ]);

    if ((args.categoria && !categoriaId) || (args.proveedor && !proveedorId)) {
      return {
        totalProductos: 0,
        normales: 0,
        criticos: 0,
        sinResultados: true,
        metricas: metricas(
          metrica('totalProductos', 'Total de productos', 0, 'number'),
          metrica('normales', 'Normales', 0, 'number'),
          metrica('criticos', 'Críticos', 0, 'number'),
        ),
        columnas: [],
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const resultado = await this.reportesStock.estado({
      categoriaId: categoriaId ?? undefined,
      proveedorId: proveedorId ?? undefined,
    });

    return {
      totalProductos: resultado.total,
      normales: resultado.normales,
      criticos: resultado.criticos,
      pctNormal: resultado.pctNormal,
      pctCritico: resultado.pctCritico,
      ...(resultado.total === 0 && { sinResultados: true as const }),
      metricas: metricas(
        metrica('totalProductos', 'Total de productos', resultado.total, 'number'),
        metrica('normales', 'Normales', resultado.normales, 'number'),
        metrica('criticos', 'Críticos', resultado.criticos, 'number'),
        metrica('pctNormal', '% Normal', resultado.pctNormal, 'percent'),
        metrica('pctCritico', '% Crítico', resultado.pctCritico, 'percent'),
      ),
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** S4 — categorías y cantidad de productos por cada una (incluye categorías sin productos). */
  private async categorias(): Promise<ConsultarStockResultado> {
    const categorias = await this.prisma.categoria.findMany({
      include: { _count: { select: { productos: true } } },
      orderBy: { nombre: 'asc' },
    });

    if (categorias.length === 0) {
      return {
        categorias: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_CATEGORIAS,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const detalle = categorias.slice(0, LIMIT).map((c) => ({
      categoriaNombre: c.nombre,
      cantidadProductos: c._count.productos,
    }));

    return {
      categorias: detalle,
      total: categorias.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_CATEGORIAS,
      filas: detalle,
      metadata: metadata(categorias.length, detalle.length),
    };
  }

  /** S5 — ranking de productos con más movimientos de stock en el rango dado. */
  private async rotacion(
    args: ConsultarStockArgs,
  ): Promise<ConsultarStockResultado> {
    if (!args.desde || !args.hasta) {
      throw new BadRequestException(
        'desde y hasta son requeridos para modo rotacion.',
      );
    }

    const gte = new Date(args.desde);
    const lt = new Date(new Date(args.hasta).getTime() + 24 * 60 * 60 * 1000);

    const filas = await this.prisma.movimientoStock.groupBy({
      by: ['productoId'],
      where: { fecha: { gte, lt } },
      _count: { _all: true },
    });

    if (filas.length === 0) {
      return {
        rotacion: [],
        total: 0,
        limit: LIMIT,
        sinResultados: true,
        metricas: [],
        columnas: COLUMNAS_ROTACION,
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    const productos = await this.prisma.producto.findMany({
      where: { id: { in: filas.map((f) => f.productoId) } },
      select: { id: true, nombre: true },
    });
    const nombrePorId = new Map(productos.map((p) => [p.id, p.nombre]));

    const rotacion = filas
      .map((f) => ({
        productoNombre: nombrePorId.get(f.productoId) ?? f.productoId,
        cantidadMovimientos: f._count._all,
      }))
      .sort((a, b) => b.cantidadMovimientos - a.cantidadMovimientos);

    const mostrado = rotacion.slice(0, LIMIT);

    return {
      rotacion: mostrado,
      total: rotacion.length,
      limit: LIMIT,
      metricas: [],
      columnas: COLUMNAS_ROTACION,
      filas: mostrado,
      metadata: metadata(rotacion.length, mostrado.length),
    };
  }

  /** Casos sin entidad resuelta (producto no encontrado, ambiguo): sin datos que listar. */
  private sinEntidades(
    campos: Partial<ConsultarStockResultado>,
  ): ConsultarStockResultado {
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
  private async resolverProducto(nombre: string): Promise<
    | { estado: 'no-encontrado' }
    | { estado: 'ambiguo'; candidatos: string[] }
    | { estado: 'ok'; id: string; nombre: string }
  > {
    const candidatos = await this.prisma.producto.findMany({
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

  /** Mismo patrón que `resolverId` de `reposicion-stock.tool.ts`: nombre → id exacto. */
  private async resolverId(
    tipo: 'categoria' | 'proveedor',
    nombre: string | null | undefined,
  ): Promise<string | null> {
    if (!nombre) return null;
    const where = {
      nombre: { contains: nombre, mode: 'insensitive' as const },
    };
    const encontrado =
      tipo === 'categoria'
        ? await this.prisma.categoria.findFirst({ where, select: { id: true } })
        : await this.prisma.proveedor.findFirst({
            where,
            select: { id: true },
          });
    return encontrado?.id ?? null;
  }
}
