import { Injectable } from '@nestjs/common';
import { FormaPagoVenta, TipoCliente } from '@prisma/client';
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

export interface ConsultarClientesArgs {
  cliente?: string | null;
  desde?: string | null;
  hasta?: string | null;
}

export interface ClienteInfoDto {
  nombre: string;
  tipo: TipoCliente;
  /** `null` para CF (reglaNegocio2: CF nunca tiene cuenta corriente ni deuda propia). */
  deuda: number | null;
  totalComprado: number;
  aclaracion?: string;
}

export interface ConsultarClientesResultado extends ResultadoPresentable {
  clientes: ClienteInfoDto[];
  total: number;
  limit: number;
  totalDeuda: number;
  cantidadClientesConDeuda: number;
  totalVentasContado: number;
  totalVentasCuentaCorriente: number;
  cantidadVentasContado: number;
  cantidadVentasCuentaCorriente: number;
  sinResultados?: true;
}

const ACLARACION_CF =
  'CF opera de contado, no tiene saldo ni cuenta corriente.';

// Tope de filas tabulares (spec `compartido/19`, ampliación 2026-09-08): ninguna tool
// devuelve más de 50 registros. Los agregados (`totalDeuda`, etc.) se calculan sobre
// `clientesInfo` completo, no sobre el recorte de `clientes`.
const LIMIT = LIMITE_RESULTADOS;

const COLUMNAS_CLIENTES: Columna[] = [
  col.text('nombre', 'Cliente'),
  col.text('tipo', 'Tipo'),
  col.currency('deuda', 'Deuda'),
  col.currency('totalComprado', 'Total comprado'),
];

/**
 * Tool `consultarClientes` (spec `compartido/17`) — decisión cerrada con el usuario
 * (2026-09-07): sin filtros de producto/categoría/proveedor (no aplican a `Cliente`), con
 * `cliente` (nombre, contains+insensitive) opcional en su lugar.
 *
 * `CF` (reglaNegocio2/41) nunca tiene deuda/cuenta corriente propia — representa ventas
 * agregadas, no un cliente con identidad. Por eso nunca se reporta `deuda` para CF (se
 * fuerza a `null` con `aclaracion` explícita), y el listado de deuda sin filtro de
 * `cliente` excluye CF. El agregado contado/cta-cte (`totalVentasContado`/
 * `totalVentasCuentaCorriente`) sale directo de `Venta.formaPago`, no de `Cliente`.
 */
@Injectable()
export class ClientesToolService {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    args: ConsultarClientesArgs,
  ): Promise<ConsultarClientesResultado> {
    const rangoFecha = this.rangoFecha(args);

    const clientes = await this.prisma.cliente.findMany({
      where: {
        ...(args.cliente
          ? { nombre: { contains: args.cliente, mode: 'insensitive' } }
          : { tipo: { not: TipoCliente.CF } }),
      },
      select: { id: true, nombre: true, tipo: true, deuda: true },
    });

    const totalComprado = await this.totalCompradoPorCliente(
      clientes.map((c) => c.id),
      rangoFecha,
    );
    // El agregado contado/cta-cte es una vista GLOBAL (todas las ventas, no las de un
    // cliente puntual) — solo tiene sentido cuando la pregunta no filtra por `cliente`.
    // Calcularlo igual con un filtro `cliente` sin matches "tapaba" el sinResultados con
    // datos de ventas ajenas al cliente buscado.
    const {
      totalVentasContado,
      totalVentasCuentaCorriente,
      cantidadVentasContado,
      cantidadVentasCuentaCorriente,
    } = args.cliente
      ? {
          totalVentasContado: 0,
          totalVentasCuentaCorriente: 0,
          cantidadVentasContado: 0,
          cantidadVentasCuentaCorriente: 0,
        }
      : await this.agregadoPorFormaPago(rangoFecha);

    const clientesInfo: ClienteInfoDto[] = clientes.map((c) => ({
      nombre: c.nombre,
      tipo: c.tipo,
      deuda: c.tipo === TipoCliente.CF ? null : Number(c.deuda),
      totalComprado: totalComprado.get(c.id) ?? 0,
      ...(c.tipo === TipoCliente.CF && { aclaracion: ACLARACION_CF }),
    }));

    const sinDatos = args.cliente
      ? clientesInfo.length === 0
      : clientesInfo.length === 0 &&
        totalVentasContado === 0 &&
        totalVentasCuentaCorriente === 0;

    const mostrado = clientesInfo.slice(0, LIMIT);
    const totalDeuda = clientesInfo.reduce((acc, c) => acc + (c.deuda ?? 0), 0);
    const cantidadClientesConDeuda = clientesInfo.filter(
      (c) => (c.deuda ?? 0) > 0,
    ).length;

    return {
      clientes: mostrado,
      total: clientesInfo.length,
      limit: LIMIT,
      totalDeuda,
      cantidadClientesConDeuda,
      totalVentasContado,
      totalVentasCuentaCorriente,
      cantidadVentasContado,
      cantidadVentasCuentaCorriente,
      ...(sinDatos && { sinResultados: true as const }),
      metricas: metricas(
        metrica('totalDeuda', 'Deuda total', totalDeuda, 'currency'),
        metrica(
          'cantidadClientesConDeuda',
          'Clientes con deuda',
          cantidadClientesConDeuda,
          'number',
        ),
        // Agregado GLOBAL contado vs. cta-cte: sin sentido cuando la pregunta filtra por
        // UN cliente puntual — con `args.cliente` estos campos quedan forzados a `0` sin
        // dato real detrás (ver comentario en `agregadoPorFormaPago` más abajo), así que
        // no se muestran como si fueran la respuesta.
        args.cliente
          ? null
          : metrica(
              'totalVentasContado',
              'Ventas contado',
              totalVentasContado,
              'currency',
            ),
        args.cliente
          ? null
          : metrica(
              'totalVentasCuentaCorriente',
              'Ventas cta. cte.',
              totalVentasCuentaCorriente,
              'currency',
            ),
      ),
      columnas: COLUMNAS_CLIENTES,
      filas: mostrado.map((c) => ({ ...c })),
      metadata: metadata(clientesInfo.length, mostrado.length),
    };
  }

  private rangoFecha(
    args: ConsultarClientesArgs,
  ): { gte: Date; lt: Date } | undefined {
    if (!args.desde || !args.hasta) return undefined;
    return {
      gte: new Date(args.desde),
      lt: new Date(new Date(args.hasta).getTime() + 24 * 60 * 60 * 1000),
    };
  }

  private async totalCompradoPorCliente(
    clienteIds: string[],
    fecha: { gte: Date; lt: Date } | undefined,
  ): Promise<Map<string, number>> {
    if (clienteIds.length === 0) return new Map();

    const filas = await this.prisma.venta.groupBy({
      by: ['clienteId'],
      where: { clienteId: { in: clienteIds }, ...(fecha && { fecha }) },
      _sum: { total: true },
    });

    return new Map(filas.map((f) => [f.clienteId, Number(f._sum.total ?? 0)]));
  }

  private async agregadoPorFormaPago(
    fecha: { gte: Date; lt: Date } | undefined,
  ): Promise<{
    totalVentasContado: number;
    totalVentasCuentaCorriente: number;
    cantidadVentasContado: number;
    cantidadVentasCuentaCorriente: number;
  }> {
    const filas = await this.prisma.venta.groupBy({
      by: ['formaPago'],
      where: { ...(fecha && { fecha }) },
      _sum: { total: true },
      _count: true,
    });

    const contado = filas.find((f) => f.formaPago === FormaPagoVenta.CONTADO);
    const ctaCte = filas.find(
      (f) => f.formaPago === FormaPagoVenta.CUENTA_CORRIENTE,
    );

    return {
      totalVentasContado: Number(contado?._sum.total ?? 0),
      totalVentasCuentaCorriente: Number(ctaCte?._sum.total ?? 0),
      cantidadVentasContado: contado?._count ?? 0,
      cantidadVentasCuentaCorriente: ctaCte?._count ?? 0,
    };
  }
}
