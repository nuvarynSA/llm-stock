import { BadRequestException, Injectable } from '@nestjs/common';
import { ModalidadComercial } from '@prisma/client';
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

export type ModoConsultarListasPrecio = 'resumen' | 'porCliente' | 'producto';

const MODOS_VALIDOS: ModoConsultarListasPrecio[] = [
  'resumen',
  'porCliente',
  'producto',
];

export interface ConsultarListasPrecioArgs {
  modo?: ModoConsultarListasPrecio | null;
  /** Nombre del cliente (contains+insensitive), requerido en modo `porCliente`, opcional en `producto`. */
  cliente?: string | null;
  /** Nombre del producto (contains+insensitive), requerido en modo `producto`. */
  producto?: string | null;
  /** Nombre de la lista (contains+insensitive), opcional en modo `producto`. */
  lista?: string | null;
}

export interface ListaPrecioResumenDto {
  nombre: string;
  cantidadProductos: number;
  cantidadClientes: number;
}

export interface ListaPrecioClienteDto {
  nombre: string;
  esAutomatica: boolean;
}

export interface PrecioProductoListaDto {
  lista: string;
  modalidad: ModalidadComercial;
  precio: number;
}

export interface ConsultarListasPrecioResultado extends ResultadoPresentable {
  // modo 'resumen' (default)
  listas?: ListaPrecioResumenDto[];

  // entidades no resueltas, compartido entre los 3 modos (cliente/lista/producto)
  clienteNoEncontrado?: true;
  listaNoEncontrada?: true;
  productoNoEncontrado?: true;
  ambiguo?: true;
  candidatos?: string[];

  // modo 'porCliente'
  nombre?: string;
  listasCliente?: ListaPrecioClienteDto[];

  // modo 'producto'
  productoNombre?: string;
  precios?: PrecioProductoListaDto[];

  // pagination de modos tabulares sin cota natural propia (`resumen`, `producto`)
  total?: number;
  limit?: number;
  sinResultados?: true;
}

type EntidadResuelta =
  | { estado: 'no-encontrado' }
  | { estado: 'ambiguo'; candidatos: string[] }
  | { estado: 'ok'; id: string; nombre: string };

// Tope de filas tabulares (spec `compartido/19`): ninguna tool devuelve más de 50 registros.
const LIMIT = LIMITE_RESULTADOS;

const COLUMNAS_RESUMEN: Columna[] = [
  col.text('nombre', 'Lista'),
  col.number('cantidadProductos', 'Productos'),
  col.number('cantidadClientes', 'Clientes'),
];

const COLUMNAS_POR_CLIENTE: Columna[] = [
  col.text('nombre', 'Lista'),
  col.status('esAutomatica', 'Automática'),
];

const COLUMNAS_PRECIO_PRODUCTO: Columna[] = [
  col.text('lista', 'Lista'),
  col.status('modalidad', 'Modalidad'),
  col.currency('precio', 'Precio'),
];

/**
 * Tool `consultarListasPrecio` (spec `compartido/23`) — único caso hasta ahora donde el
 * dominio (`ListaPrecio`/`ClienteListaPrecio`/`ListaPrecioClienteItem`) no está tocado por
 * ninguna de las otras tools de `ia/`. Prisma directo, sin importar `VentasModule`: aunque
 * `ListasPreciosService` sólo depende de `PrismaService`, `VentasModule` arrastra el ciclo
 * `forwardRef(() => CajaModule)` igual si se importa el módulo completo.
 *
 * `resumen`/`producto` listan entidades concretas — sin métricas de relleno, mismo criterio
 * que el resto de `ia/tools/`. `porCliente` también lista entidades (las listas asignadas),
 * sin agregados propios.
 */
@Injectable()
export class ListasPrecioToolService {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    args: ConsultarListasPrecioArgs,
  ): Promise<ConsultarListasPrecioResultado> {
    if (
      args.modo != null &&
      !MODOS_VALIDOS.includes(args.modo as ModoConsultarListasPrecio)
    ) {
      throw new BadRequestException(`modo inválido: ${args.modo}`);
    }

    switch (args.modo) {
      case 'porCliente':
        return this.porCliente(args);
      case 'producto':
        return this.producto(args);
      default:
        return this.resumen();
    }
  }

  private async resumen(): Promise<ConsultarListasPrecioResultado> {
    const listas = await this.prisma.listaPrecio.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        nombre: true,
        _count: { select: { items: true, clientes: true } },
      },
    });

    const detalle: ListaPrecioResumenDto[] = listas.map((l) => ({
      nombre: l.nombre,
      cantidadProductos: l._count.items,
      cantidadClientes: l._count.clientes,
    }));
    const mostrado = detalle.slice(0, LIMIT);

    return {
      listas: mostrado,
      total: detalle.length,
      limit: LIMIT,
      ...(detalle.length === 0 && { sinResultados: true as const }),
      metricas: metricas(
        metrica('cantidadListas', 'Listas de precio', detalle.length, 'number'),
      ),
      columnas: COLUMNAS_RESUMEN,
      filas: mostrado.map((l) => ({ ...l })),
      metadata: metadata(detalle.length, mostrado.length),
    };
  }

  /** Listas asignadas a UN cliente puntual, marcando cuál es la automática. */
  private async porCliente(
    args: ConsultarListasPrecioArgs,
  ): Promise<ConsultarListasPrecioResultado> {
    if (!args.cliente) {
      throw new BadRequestException(
        'cliente es requerido para modo porCliente.',
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

    const cliente = await this.prisma.cliente.findUniqueOrThrow({
      where: { id: resuelto.id },
      select: {
        listaAutomaticaId: true,
        listasPrecios: {
          select: { listaPrecio: { select: { id: true, nombre: true } } },
        },
      },
    });

    const detalle: ListaPrecioClienteDto[] = cliente.listasPrecios.map(
      (lp) => ({
        nombre: lp.listaPrecio.nombre,
        esAutomatica: lp.listaPrecio.id === cliente.listaAutomaticaId,
      }),
    );

    return {
      nombre: resuelto.nombre,
      listasCliente: detalle,
      ...(detalle.length === 0 && { sinResultados: true as const }),
      metricas: [],
      columnas: COLUMNAS_POR_CLIENTE,
      filas: detalle.map((d) => ({ ...d })),
      metadata: metadata(detalle.length, detalle.length),
    };
  }

  /**
   * Precio de UN producto puntual. Sin `lista` ni `cliente`: una fila por lista donde
   * aparece (precio dual entre listas es correcto, no ambigüedad a resolver). Con `lista`:
   * acota a esa lista. Con `cliente` (sin `lista`): cruza con las listas asignadas a ese
   * cliente. `lista` gana si se pasan ambos — es el filtro más específico de los dos.
   */
  private async producto(
    args: ConsultarListasPrecioArgs,
  ): Promise<ConsultarListasPrecioResultado> {
    if (!args.producto) {
      throw new BadRequestException(
        'producto es requerido para modo producto.',
      );
    }

    const productoResuelto = await this.resolverProducto(args.producto);
    if (productoResuelto.estado === 'no-encontrado') {
      return this.sinEntidades({ productoNoEncontrado: true });
    }
    if (productoResuelto.estado === 'ambiguo') {
      return this.sinEntidades({
        ambiguo: true,
        candidatos: productoResuelto.candidatos,
      });
    }

    let listaIds: string[] | undefined;

    if (args.lista) {
      const listaResuelta = await this.resolverLista(args.lista);
      if (listaResuelta.estado === 'no-encontrado') {
        return this.sinEntidades({
          productoNombre: productoResuelto.nombre,
          listaNoEncontrada: true,
        });
      }
      if (listaResuelta.estado === 'ambiguo') {
        return this.sinEntidades({
          productoNombre: productoResuelto.nombre,
          ambiguo: true,
          candidatos: listaResuelta.candidatos,
        });
      }
      listaIds = [listaResuelta.id];
    } else if (args.cliente) {
      const clienteResuelto = await this.resolverCliente(args.cliente);
      if (clienteResuelto.estado === 'no-encontrado') {
        return this.sinEntidades({
          productoNombre: productoResuelto.nombre,
          clienteNoEncontrado: true,
        });
      }
      if (clienteResuelto.estado === 'ambiguo') {
        return this.sinEntidades({
          productoNombre: productoResuelto.nombre,
          ambiguo: true,
          candidatos: clienteResuelto.candidatos,
        });
      }
      const cliente = await this.prisma.cliente.findUniqueOrThrow({
        where: { id: clienteResuelto.id },
        select: { listasPrecios: { select: { listaPrecioId: true } } },
      });
      listaIds = cliente.listasPrecios.map((lp) => lp.listaPrecioId);
    }

    const items = await this.prisma.listaPrecioClienteItem.findMany({
      where: {
        productoId: productoResuelto.id,
        ...(listaIds && { listaId: { in: listaIds } }),
      },
      select: { modalidad: true, precio: true, lista: { select: { nombre: true } } },
      orderBy: { lista: { nombre: 'asc' } },
    });

    const detalle: PrecioProductoListaDto[] = items.map((i) => ({
      lista: i.lista.nombre,
      modalidad: i.modalidad,
      precio: Number(i.precio),
    }));
    const mostrado = detalle.slice(0, LIMIT);

    return {
      productoNombre: productoResuelto.nombre,
      precios: mostrado,
      total: detalle.length,
      limit: LIMIT,
      ...(detalle.length === 0 && { sinResultados: true as const }),
      metricas: [],
      columnas: COLUMNAS_PRECIO_PRODUCTO,
      filas: mostrado.map((d) => ({ ...d })),
      metadata: metadata(detalle.length, mostrado.length),
    };
  }

  /** Casos sin entidad resuelta (cliente/lista/producto no encontrado, ambiguo). */
  private sinEntidades(
    campos: Partial<ConsultarListasPrecioResultado>,
  ): ConsultarListasPrecioResultado {
    return {
      ...campos,
      metricas: [],
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }

  /** Contains + insensitive, sin match = no encontrado, más de un match = ambiguo — mismo
   *  criterio que `resolverCliente` de `ventas.tool.ts` y `resolverProducto` de `stock.tool.ts`. */
  private async resolverPorNombre(
    buscar: () => Promise<{ id: string; nombre: string }[]>,
  ): Promise<EntidadResuelta> {
    const candidatos = await buscar();
    if (candidatos.length === 0) return { estado: 'no-encontrado' };
    if (candidatos.length > 1) {
      return { estado: 'ambiguo', candidatos: candidatos.map((c) => c.nombre) };
    }
    return { estado: 'ok', id: candidatos[0].id, nombre: candidatos[0].nombre };
  }

  private resolverCliente(nombre: string): Promise<EntidadResuelta> {
    return this.resolverPorNombre(() =>
      this.prisma.cliente.findMany({
        where: { nombre: { contains: nombre, mode: 'insensitive' } },
        select: { id: true, nombre: true },
      }),
    );
  }

  private resolverProducto(nombre: string): Promise<EntidadResuelta> {
    return this.resolverPorNombre(() =>
      this.prisma.producto.findMany({
        where: { nombre: { contains: nombre, mode: 'insensitive' } },
        select: { id: true, nombre: true },
      }),
    );
  }

  private resolverLista(nombre: string): Promise<EntidadResuelta> {
    return this.resolverPorNombre(() =>
      this.prisma.listaPrecio.findMany({
        where: { nombre: { contains: nombre, mode: 'insensitive' } },
        select: { id: true, nombre: true },
      }),
    );
  }
}
