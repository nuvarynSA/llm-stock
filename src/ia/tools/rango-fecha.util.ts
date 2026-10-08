/**
 * Rango `[desde, hasta+1día)` (spec `compartido/21`) — mismo patrón repetido literal en
 * `caja.tool.ts`, `tesoreria.tool.ts`, `compras.tool.ts`, `margen.tool.ts`, `ventas.tool.ts`,
 * `clientes.tool.ts`, `resumen-proveedor.tool.ts` y `estado-cuenta-cliente.graph.ts`: `hasta`
 * es inclusive del día completo, así que se suma 24hs y se compara con `lt` (exclusivo) en vez
 * de `lte`, para no perder ventas/movimientos cargados en cualquier horario de ese día.
 *
 * Extraído en la Fase 1 de `compartido/21` — se usa solo en el código nuevo de esa spec, las
 * 8 copias existentes no se migran (fuera de alcance).
 */
export function rangoFecha(desde: string, hasta: string): { gte: Date; lt: Date } {
  return {
    gte: new Date(desde),
    lt: new Date(new Date(hasta).getTime() + 24 * 60 * 60 * 1000),
  };
}
