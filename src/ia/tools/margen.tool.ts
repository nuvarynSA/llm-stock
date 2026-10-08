import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { costoPorUnidadStock } from '../../shared/costo-proveedor.util';
import {
  metadata,
  metrica,
  metricas,
  ResultadoPresentable,
} from '../presentacion/presentacion';

export interface ConsultarMargenArgs {
  desde: string;
  hasta: string;
  producto?: string | null;
  categoria?: string | null;
  proveedor?: string | null;
}

export interface ConsultarMargenResultado extends ResultadoPresentable {
  ventas: number;
  costo: number;
  margenBruto: number;
  margenPorcentaje: number;
  itemsSinCosto: number;
  /**
   * `true` si al menos un ítem del período no tenía `VentaItem.costoUnitarioVenta` persistido
   * (venta anterior a la migración de la spec `ventas/10`, o producto sin `PrecioProveedor`
   * cargado en ese momento) y se resolvió con el precio VIGENTE de `PrecioProveedor` en su
   * lugar (o quedó sin costo, ver `itemsSinCosto`). `false` = margen exacto: todos los ítems
   * del período usaron su costo histórico congelado al momento de la venta.
   */
  esEstimado: boolean;
  sinResultados?: true;
}

/**
 * Tool `consultarMargen` (spec `compartido/17`) — margen bruto por período. Usa el costo
 * histórico congelado en `VentaItem.costoUnitarioVenta` (spec `ventas/10`) cuando está
 * disponible; si es `null` (venta anterior a esa migración, o producto sin `PrecioProveedor`
 * cargado al momento de la venta), cae al precio VIGENTE de `PrecioProveedor`, normalizando
 * modalidad con `pesoPorUnidad` (reglaNegocio44/48) vía `costoPorUnidadStock` — y ese fallback
 * es lo que marca el resultado como `esEstimado`. Los ítems sin ningún costo disponible (ni
 * histórico ni vigente) se excluyen del cálculo y se cuentan en `itemsSinCosto`.
 */
@Injectable()
export class MargenToolService {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(args: ConsultarMargenArgs): Promise<ConsultarMargenResultado> {
    const desde = new Date(args.desde);
    const hasta = new Date(
      new Date(args.hasta).getTime() + 24 * 60 * 60 * 1000,
    );

    const items = await this.prisma.ventaItem.findMany({
      where: {
        venta: { fecha: { gte: desde, lt: hasta } },
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
        modalidad: true,
        cantidadStock: true,
        subtotal: true,
        costoUnitarioVenta: true,
        producto: {
          select: {
            unidad: true,
            pesoPorUnidad: true,
            preciosProveedor: { select: { modalidad: true, precio: true } },
          },
        },
      },
    });

    if (items.length === 0) {
      return {
        ventas: 0,
        costo: 0,
        margenBruto: 0,
        margenPorcentaje: 0,
        itemsSinCosto: 0,
        esEstimado: true,
        sinResultados: true,
        metricas: metricas(
          metrica('ventas', 'Ventas', 0, 'currency'),
          metrica('costo', 'Costo', 0, 'currency'),
          metrica('margenBruto', 'Margen bruto', 0, 'currency'),
          metrica('margenPorcentaje', 'Margen', 0, 'percent'),
        ),
        columnas: [],
        filas: [],
        metadata: metadata(0, 0),
      };
    }

    let ventas = 0;
    let costo = 0;
    let itemsSinCosto = 0;
    let esEstimado = false;

    for (const item of items) {
      let costoUnitario: number | null;
      if (item.costoUnitarioVenta == null) {
        esEstimado = true;
        costoUnitario = costoPorUnidadStock(item.producto, item.modalidad);
      } else {
        costoUnitario = Number(item.costoUnitarioVenta);
      }

      if (costoUnitario === null) {
        itemsSinCosto += 1;
        continue;
      }
      ventas += Number(item.subtotal);
      costo += costoUnitario * Number(item.cantidadStock);
    }

    const margenBruto = ventas - costo;
    const margenPorcentaje = ventas ? (margenBruto / ventas) * 100 : 0;

    return {
      ventas,
      costo,
      margenBruto,
      margenPorcentaje,
      itemsSinCosto,
      esEstimado,
      metricas: metricas(
        metrica('ventas', 'Ventas', ventas, 'currency'),
        metrica('costo', 'Costo', costo, 'currency'),
        metrica('margenBruto', 'Margen bruto', margenBruto, 'currency'),
        metrica('margenPorcentaje', 'Margen', margenPorcentaje, 'percent'),
        // Sólo si hay ítems sin costo: en `0` es ruido (todo el período tuvo costo
        // disponible, no aporta destacarlo como tarjeta aparte).
        itemsSinCosto > 0
          ? metrica('itemsSinCosto', 'Ítems sin costo', itemsSinCosto, 'number')
          : null,
      ),
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    };
  }
}
