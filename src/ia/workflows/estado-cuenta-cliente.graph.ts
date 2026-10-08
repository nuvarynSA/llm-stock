import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  FormaPagoVenta,
  Prisma,
  TipoCliente,
  TipoMovimientoCtaCte,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UltimoMovimientoDto,
  VentaPendienteDto,
} from '../tools/estado-cuenta-cliente.tool';

const ACLARACION_CF =
  'CF opera de contado, no tiene saldo ni cuenta corriente.';

// Tope de filas tabulares (spec `compartido/19`): ninguna tool devuelve más de 50 registros.
const LIMIT = 50;

export const NOMBRE_WORKFLOW_ESTADO_CUENTA_CLIENTE = 'estado-cuenta-cliente';

interface ClienteResuelto {
  id: string;
  nombre: string;
  tipo: TipoCliente;
  deuda: Prisma.Decimal;
}

const EstadoCuentaClienteState = Annotation.Root({
  cliente: Annotation<string>(),
  desde: Annotation<string | null | undefined>(),
  hasta: Annotation<string | null | undefined>(),
  clienteEncontrado: Annotation<ClienteResuelto | undefined>(),
  clienteNoEncontrado: Annotation<true | undefined>(),
  ambiguo: Annotation<true | undefined>(),
  candidatos: Annotation<string[] | undefined>(),
  nombre: Annotation<string | undefined>(),
  esCF: Annotation<true | undefined>(),
  aclaracion: Annotation<string | undefined>(),
  saldoPendiente: Annotation<number | undefined>(),
  ventasPendientes: Annotation<number | undefined>(),
  ultimoMovimiento: Annotation<UltimoMovimientoDto | null | undefined>(),
  detalle: Annotation<VentaPendienteDto[] | undefined>(),
  total: Annotation<number | undefined>(),
  limit: Annotation<number | undefined>(),
  sinResultados: Annotation<true | undefined>(),
  inconsistente: Annotation<true | undefined>(),
  pasos: Annotation<string[]>({
    reducer: (actual, actualizacion) => actual.concat(actualizacion),
    default: () => [],
  }),
});

export type EstadoCuentaClienteGraphState =
  typeof EstadoCuentaClienteState.State;
type EstadoCuentaClienteGraphUpdate = typeof EstadoCuentaClienteState.Update;

function rangoFecha(
  desde: string | null | undefined,
  hasta: string | null | undefined,
): { gte: Date; lt: Date } | undefined {
  if (!desde || !hasta) return undefined;
  return {
    gte: new Date(desde),
    lt: new Date(new Date(hasta).getTime() + 24 * 60 * 60 * 1000),
  };
}

/**
 * Grafo LangGraph (Fase 3a) que reorganiza la lógica de `EstadoCuentaClienteToolService` en
 * nodos determinísticos con branching explícito. Sin llamadas al LLM: todo Prisma directo,
 * mismo criterio que la tool original (fórmula C12, `docs/business-rules/ventas/invariantesCobros.md`).
 */
export function construirGrafoEstadoCuentaCliente(prisma: PrismaService) {
  async function resolverCliente(
    state: EstadoCuentaClienteGraphState,
  ): Promise<EstadoCuentaClienteGraphUpdate> {
    const candidatos = await prisma.cliente.findMany({
      where: { nombre: { contains: state.cliente, mode: 'insensitive' } },
      select: { id: true, nombre: true, tipo: true, deuda: true },
    });

    if (candidatos.length === 0) {
      return { clienteNoEncontrado: true, pasos: ['resolverCliente'] };
    }
    if (candidatos.length > 1) {
      return {
        ambiguo: true,
        candidatos: candidatos.map((c) => c.nombre),
        pasos: ['resolverCliente'],
      };
    }
    return { clienteEncontrado: candidatos[0], pasos: ['resolverCliente'] };
  }

  function estadoCuenta(
    state: EstadoCuentaClienteGraphState,
  ): EstadoCuentaClienteGraphUpdate {
    const cliente = state.clienteEncontrado!;
    if (cliente.tipo === TipoCliente.CF) {
      return {
        nombre: cliente.nombre,
        esCF: true,
        aclaracion: ACLARACION_CF,
        pasos: ['estadoCuenta'],
      };
    }
    return {
      nombre: cliente.nombre,
      saldoPendiente: Number(cliente.deuda),
      pasos: ['estadoCuenta'],
    };
  }

  async function operacionesPendientes(
    state: EstadoCuentaClienteGraphState,
  ): Promise<EstadoCuentaClienteGraphUpdate> {
    const cliente = state.clienteEncontrado!;
    const fecha = rangoFecha(state.desde, state.hasta);
    const ventas = await prisma.venta.findMany({
      where: {
        clienteId: cliente.id,
        formaPago: FormaPagoVenta.CUENTA_CORRIENTE,
        ...(fecha && { fecha }),
      },
      select: { id: true, numero: true, fecha: true, total: true },
    });

    const cobros = await prisma.movimientoCtaCte.groupBy({
      by: ['ventaId'],
      where: {
        ventaId: { in: ventas.map((v) => v.id) },
        tipo: TipoMovimientoCtaCte.COBRO,
      },
      _sum: { haber: true },
    });
    const cobradoPorVenta = new Map<string, number>();
    for (const c of cobros) {
      if (c.ventaId) cobradoPorVenta.set(c.ventaId, Number(c._sum.haber ?? 0));
    }

    const pendientes: VentaPendienteDto[] = ventas
      .map((v) => ({
        ventaId: v.id,
        numero: v.numero,
        fecha: v.fecha.toISOString(),
        total: Number(v.total),
        saldoPendiente: Number(v.total) - (cobradoPorVenta.get(v.id) ?? 0),
      }))
      .filter((v) => v.saldoPendiente > 0);

    const ultimoMovimiento = await prisma.movimientoCtaCte.findFirst({
      where: { clienteId: cliente.id },
      orderBy: { fecha: 'desc' },
      select: {
        fecha: true,
        tipo: true,
        debe: true,
        haber: true,
        venta: { select: { numero: true } },
      },
    });

    return {
      ventasPendientes: pendientes.length,
      ultimoMovimiento: ultimoMovimiento
        ? {
            fecha: ultimoMovimiento.fecha.toISOString(),
            tipo: ultimoMovimiento.tipo,
            monto: Number(
              ultimoMovimiento.tipo === TipoMovimientoCtaCte.VENTA
                ? ultimoMovimiento.debe
                : ultimoMovimiento.haber,
            ),
            ventaNumero: ultimoMovimiento.venta?.numero ?? null,
          }
        : null,
      detalle: pendientes.slice(0, LIMIT),
      total: pendientes.length,
      limit: LIMIT,
      ...(pendientes.length === 0 && { sinResultados: true as const }),
      pasos: ['operacionesPendientes'],
    };
  }

  /**
   * Compara Σ `saldoPendiente` del `detalle` (lo que realmente se expone al modelo/usuario,
   * capado a `LIMIT`) contra `Cliente.deuda`. La diferencia es "explicable" — y por lo tanto
   * NO se marca `inconsistente` — en dos casos donde el detalle nunca puede reflejar toda la
   * deuda: (1) se pasó un filtro `desde`/`hasta`, que por diseño excluye ventas fuera del
   * rango; (2) el cliente tiene más de `LIMIT` ventas pendientes, así que `detalle` quedó
   * truncado (`total > limit`). Fuera de esos dos casos, cualquier diferencia entre la suma y
   * `Cliente.deuda` es un dato real e inesperado — se marca, no se corrige ni se oculta.
   */
  function validar(
    state: EstadoCuentaClienteGraphState,
  ): EstadoCuentaClienteGraphUpdate {
    const detalle = state.detalle ?? [];
    const sumaDetalle = detalle.reduce((acc, v) => acc + v.saldoPendiente, 0);
    const huboFiltroFecha = Boolean(state.desde && state.hasta);
    const huboTope = (state.total ?? 0) > (state.limit ?? LIMIT);
    const diferenciaExplicable = huboFiltroFecha || huboTope;
    const inconsistente =
      !diferenciaExplicable && sumaDetalle !== (state.saldoPendiente ?? 0);

    return {
      ...(inconsistente && { inconsistente: true as const }),
      pasos: ['validar'],
    };
  }

  return new StateGraph(EstadoCuentaClienteState)
    .addNode('resolverCliente', resolverCliente)
    .addNode('estadoCuenta', estadoCuenta)
    .addNode('operacionesPendientes', operacionesPendientes)
    .addNode('validar', validar)
    .addEdge(START, 'resolverCliente')
    .addConditionalEdges('resolverCliente', (state) =>
      state.clienteNoEncontrado || state.ambiguo ? END : 'estadoCuenta',
    )
    .addConditionalEdges('estadoCuenta', (state) =>
      state.esCF ? END : 'operacionesPendientes',
    )
    .addEdge('operacionesPendientes', 'validar')
    .addEdge('validar', END)
    .compile();
}
