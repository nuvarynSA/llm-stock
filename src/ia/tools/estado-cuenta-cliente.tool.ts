import { Injectable } from '@nestjs/common';
import { TipoMovimientoCtaCte } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  col,
  Columna,
  metadata,
  metrica,
  metricas,
  ResultadoPresentable,
} from '../presentacion/presentacion';
import {
  construirGrafoEstadoCuentaCliente,
  NOMBRE_WORKFLOW_ESTADO_CUENTA_CLIENTE,
} from '../workflows/estado-cuenta-cliente.graph';

const COLUMNAS_DETALLE: Columna[] = [
  col.number('numero', 'Número'),
  col.date('fecha', 'Fecha'),
  col.currency('total', 'Total'),
  col.currency('saldoPendiente', 'Saldo pendiente'),
];

export interface ObtenerEstadoCuentaClienteArgs {
  cliente: string;
  desde?: string | null;
  hasta?: string | null;
}

export interface VentaPendienteDto {
  ventaId: string;
  numero: number;
  fecha: string;
  total: number;
  saldoPendiente: number;
}

/** Último movimiento de cta cte del cliente (V1, spec `compartido/21`), con monto real: `debe`
 *  para `VENTA` (aumenta la deuda), `haber` para `COBRO` (la reduce) — mismo criterio que el
 *  saldo acumulado de `ClientesService.movimientosTodos()`. */
export interface UltimoMovimientoDto {
  fecha: string;
  tipo: TipoMovimientoCtaCte;
  monto: number;
  ventaNumero: number | null;
}

export interface ObtenerEstadoCuentaClienteResultado
  extends ResultadoPresentable {
  clienteNoEncontrado?: true;
  ambiguo?: true;
  candidatos?: string[];
  nombre?: string;
  esCF?: true;
  aclaracion?: string;
  saldoPendiente?: number;
  ventasPendientes?: number;
  ultimoMovimiento?: UltimoMovimientoDto | null;
  detalle?: VentaPendienteDto[];
  total?: number;
  limit?: number;
  sinResultados?: true;
  inconsistente?: true;
  workflow: string;
  pasos: string[];
}

/**
 * Tool `obtenerEstadoCuentaCliente` (Fase 1c, reorganizada en grafo LangGraph en Fase 3a) —
 * estado de cuenta de UN cliente puntual: saldo, ventas que forman esa deuda, y último
 * movimiento. Distinta de `consultarClientes` (vista agregada del padrón completo).
 *
 * La lógica vive en `construirGrafoEstadoCuentaCliente` (`workflows/estado-cuenta-cliente.graph.ts`)
 * como un grafo de nodos determinísticos (`resolverCliente` → `estadoCuenta` →
 * `operacionesPendientes` → `validar`), sin llamadas al LLM. Esta clase solo invoca el grafo
 * compilado y traduce su estado final al contrato `ObtenerEstadoCuentaClienteResultado`.
 */
@Injectable()
export class EstadoCuentaClienteToolService {
  private readonly grafo: ReturnType<typeof construirGrafoEstadoCuentaCliente>;

  constructor(private readonly prisma: PrismaService) {
    this.grafo = construirGrafoEstadoCuentaCliente(this.prisma);
  }

  async ejecutar(
    args: ObtenerEstadoCuentaClienteArgs,
  ): Promise<ObtenerEstadoCuentaClienteResultado> {
    const estadoFinal = await this.grafo.invoke({
      cliente: args.cliente,
      desde: args.desde,
      hasta: args.hasta,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { clienteEncontrado, cliente, desde, hasta, pasos, ...publico } =
      estadoFinal;

    const detalle = publico.detalle ?? [];

    return {
      ...omitirUndefined(publico),
      workflow: NOMBRE_WORKFLOW_ESTADO_CUENTA_CLIENTE,
      pasos,
      // `detalle` son "las ventas que forman esa deuda" (spec `compartido/22`): la entidad
      // concreta a listar. `saldoPendiente`/`ventasPendientes`/`ultimoMovimiento` son el
      // agregado que las resume — sin entidades cuando el cliente es CF, no se encontró, o
      // es ambiguo (nada que listar todavía).
      metricas: metricas(
        metrica('saldoPendiente', 'Saldo pendiente', publico.saldoPendiente ?? null, 'currency'),
        metrica(
          'ventasPendientes',
          'Ventas pendientes',
          publico.ventasPendientes ?? null,
          'number',
        ),
        metrica(
          'ultimoMovimientoTipo',
          'Último movimiento',
          publico.ultimoMovimiento?.tipo ?? null,
          'text',
        ),
        metrica(
          'ultimoMovimientoMonto',
          'Monto del último movimiento',
          publico.ultimoMovimiento?.monto ?? null,
          'currency',
        ),
      ),
      columnas: detalle.length > 0 ? COLUMNAS_DETALLE : [],
      filas: detalle.map((d) => ({ ...d })),
      metadata: metadata(publico.total ?? detalle.length, detalle.length),
    };
  }
}

/** Un campo de `state` que ningún nodo tocó llega como `undefined` — se omite del contrato. */
function omitirUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, valor]) => valor !== undefined),
  ) as Partial<T>;
}
