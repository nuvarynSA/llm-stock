import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DIAS_CUBRIR } from '../../reportes/dto/filtro-reposicion.dto';
import { FilaReposicionDto } from '../../reportes/dto/reportes-stock-response.dto';
import { ReportesStockService } from '../../reportes/reportes-stock.service';
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

export interface ReposicionStockArgs {
  proveedor?: string | null;
  categoria?: string | null;
  /** Acota a un producto puntual (S2, spec `compartido/21`) — independiente de proveedor/categoria. */
  producto?: string | null;
  diasCubrir?: number | null;
  desde?: string | null;
  hasta?: string | null;
}

export interface ReposicionStockResultado extends ResultadoPresentable {
  porEstado: {
    comprarHoy: number;
    comprarPronto: number;
    suficiente: number;
    sinConsumo: number;
  };
  masUrgentes: FilaReposicionDto[];
  detalle: FilaReposicionDto[];
  total: number;
  limit: number;
  sinResultados?: true;
}

// Tope de filas tabulares (spec `compartido/19`): ninguna tool devuelve más de 50 registros.
const LIMIT = LIMITE_RESULTADOS;

const COLUMNAS_REPOSICION: Columna[] = [
  col.text('nombre', 'Producto'),
  col.status('estado', 'Urgencia'),
  col.number('stockActual', 'Stock actual'),
  col.number('consumo', 'Consumo'),
  col.number('cobertura', 'Cobertura (días)'),
  col.number('compra', 'A comprar'),
];

/**
 * Tool `reposicionStock` (Fase 1c) — reusa `ReportesStockService.reposicion()` (CU46/CU47)
 * en vez de duplicar el cálculo de consumo/cobertura. `proveedor`/`categoria`/`producto`
 * (S2, spec `compartido/21`) llegan como NOMBRE (igual que el resto de las tools de IA), se
 * resuelven a id con la primera coincidencia (`contains`, insensitive) antes de llamar al
 * service, que sólo acepta id exacto — sin match, el resultado queda vacío (`sinResultados`).
 * `producto` es independiente de la exclusión mutua proveedor/categoria (reglaNegocio14): se
 * puede combinar libremente con cualquiera de los dos para acotar la búsqueda a un producto
 * puntual dentro de ese proveedor/categoría.
 *
 * `desde`/`hasta` son opcionales acá aunque el service los exige: sin spec ni default
 * documentado para una consulta en lenguaje natural sin rango, se replica el mismo criterio
 * que ya usa el frontend cuando el usuario no elige fechas (`ReposicionStockTab.tsx:67-75`
 * `rangoPorDefecto()`): últimos 30 días (`hasta = hoy`, `desde = hoy - 29 días`).
 *
 * Nota de performance: `calcularFila` hace 2 queries por producto — el filtro de
 * proveedor/categoría (aplicado en la query de productos, antes de `calcularFila`) es lo que
 * realmente acota el costo, no el corte a `LIMIT` de acá (que sólo recorta la respuesta ya
 * calculada). Sin filtro y con catálogo grande puede acercarse al timeout de Groq
 * (`GROQ_TIMEOUT_MS`, 15s) — no verificado con un catálogo grande real en esta fase.
 */
@Injectable()
export class ReposicionStockToolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportesStock: ReportesStockService,
  ) {}

  async ejecutar(args: ReposicionStockArgs): Promise<ReposicionStockResultado> {
    this.validarArgs(args);

    const [proveedorId, categoriaId, productoId] = await Promise.all([
      this.resolverId('proveedor', args.proveedor),
      this.resolverId('categoria', args.categoria),
      this.resolverId('producto', args.producto),
    ]);

    if (
      (args.proveedor && !proveedorId) ||
      (args.categoria && !categoriaId) ||
      (args.producto && !productoId)
    ) {
      return this.vacio();
    }

    const { desde, hasta } = this.rangoODefault(args);

    const resultado = await this.reportesStock.reposicion({
      desde,
      hasta,
      diasCubrir: args.diasCubrir ?? undefined,
      proveedorId: proveedorId ?? undefined,
      categoriaId: categoriaId ?? undefined,
      productoId: productoId ?? undefined,
    });

    if (resultado.detalle.length === 0) return this.vacio();

    const mostrado: Fila[] = resultado.detalle
      .slice(0, LIMIT)
      .map((f) => ({ ...f }));

    return {
      porEstado: resultado.porEstado,
      masUrgentes: resultado.masUrgentes,
      detalle: resultado.detalle.slice(0, LIMIT),
      total: resultado.detalle.length,
      limit: LIMIT,
      metricas: metricas(
        metrica(
          'comprarHoy',
          'Comprar hoy',
          resultado.porEstado.comprarHoy,
          'number',
        ),
        metrica(
          'comprarPronto',
          'Comprar pronto',
          resultado.porEstado.comprarPronto,
          'number',
        ),
        metrica(
          'suficiente',
          'Stock suficiente',
          resultado.porEstado.suficiente,
          'number',
        ),
        metrica(
          'sinConsumo',
          'Sin consumo',
          resultado.porEstado.sinConsumo,
          'number',
        ),
      ),
      columnas: COLUMNAS_REPOSICION,
      filas: mostrado,
      metadata: metadata(resultado.detalle.length, mostrado.length),
    };
  }

  private validarArgs(args: ReposicionStockArgs): void {
    if (args.proveedor && args.categoria) {
      throw new BadRequestException(
        'proveedor y categoria son mutuamente excluyentes en reposicionStock (reglaNegocio14).',
      );
    }
    if (
      args.diasCubrir != null &&
      !DIAS_CUBRIR.includes(args.diasCubrir as (typeof DIAS_CUBRIR)[number])
    ) {
      throw new BadRequestException(`diasCubrir inválido: ${args.diasCubrir}`);
    }
  }

  private vacio(): ReposicionStockResultado {
    return {
      porEstado: {
        comprarHoy: 0,
        comprarPronto: 0,
        suficiente: 0,
        sinConsumo: 0,
      },
      masUrgentes: [],
      detalle: [],
      total: 0,
      limit: LIMIT,
      sinResultados: true,
      metricas: metricas(
        metrica('comprarHoy', 'Comprar hoy', 0, 'number'),
        metrica('comprarPronto', 'Comprar pronto', 0, 'number'),
        metrica('suficiente', 'Stock suficiente', 0, 'number'),
        metrica('sinConsumo', 'Sin consumo', 0, 'number'),
      ),
      columnas: COLUMNAS_REPOSICION,
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  private async resolverId(
    tipo: 'proveedor' | 'categoria' | 'producto',
    nombre: string | null | undefined,
  ): Promise<string | null> {
    if (!nombre) return null;
    const where = {
      nombre: { contains: nombre, mode: 'insensitive' as const },
    };
    const encontrado =
      tipo === 'proveedor'
        ? await this.prisma.proveedor.findFirst({ where, select: { id: true } })
        : tipo === 'categoria'
          ? await this.prisma.categoria.findFirst({
              where,
              select: { id: true },
            })
          : await this.prisma.producto.findFirst({
              where,
              select: { id: true },
            });
    return encontrado?.id ?? null;
  }

  /** Default 30 días — replica `ReposicionStockTab.tsx:67-75` (`rangoPorDefecto()`). */
  private rangoODefault(args: ReposicionStockArgs): {
    desde: string;
    hasta: string;
  } {
    if (args.desde && args.hasta)
      return { desde: args.desde, hasta: args.hasta };

    const hasta = new Date();
    const desde = new Date();
    desde.setDate(desde.getDate() - 29);
    return {
      desde: desde.toISOString().slice(0, 10),
      hasta: hasta.toISOString().slice(0, 10),
    };
  }
}
