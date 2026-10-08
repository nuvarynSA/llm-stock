/**
 * Contrato de presentación de los resultados de las tools (spec `compartido/22`).
 *
 * La tool declara QUÉ mostrar (`metricas`/`columnas`/`filas`/`metadata`) y el frontend sólo
 * renderiza — antes el frontend infería el panel por nombre de tool, premisa que dejó de ser
 * cierta cuando `compartido/21` agregó `modo` (27 formas de resultado sobre 10 tools).
 *
 * Vive acá, junto a los builders que lo producen, y no en `dto/consultar-ia-response.dto.ts`:
 * el contrato viaja DENTRO de `ConsultaUtilizada.resultado` (que sigue siendo `unknown`,
 * porque cada tool suma estos campos a los suyos de dominio), no en la forma del DTO. Tiparlo
 * en `ConsultaUtilizada` obligaría a las 10 tools a emitirlo para compilar, y eso es Fase 1a.
 *
 * El espejo manual de estos tipos en el frontend está en
 * `app/frontend/src/modules/reportes/api.ts` (no hay tipos compartidos entre paquetes).
 */

export type FormatoValor =
  'currency' | 'date' | 'number' | 'status' | 'percent' | 'kg' | 'un' | 'text';

export interface Metrica {
  key: string;
  label: string;
  /** `null` significa "no calculado / no disponible" y hace que la métrica NO se emita. */
  valor: number | string | null;
  format: FormatoValor;
}

export interface Columna {
  key: string;
  label: string;
  format?: FormatoValor;
}

export type ValorCelda = string | number | boolean | null;

export type Fila = Record<string, ValorCelda>;

export interface MetadataResultado {
  totalResultados: number;
  resultadosMostrados: number;
  truncado: boolean;
}

/** Resultado de una tool: sus campos de dominio de siempre más el contrato de presentación. */
export interface ResultadoPresentable {
  /** Dato que la prosa del modelo debe destacar primero. */
  resumen?: string;
  metricas: Metrica[];
  /** Vacío cuando el resultado no es tabular. */
  columnas: Columna[];
  filas: Fila[];
  metadata: MetadataResultado;
}

/** Corte que ya aplican las 10 tools (`const LIMIT = 50` en cada una). */
export const LIMITE_RESULTADOS = 50;

/**
 * Métrica del contrato, o `null` si no hay valor que mostrar — criterio 4 de la spec: nunca
 * convertir `null`/`undefined` en `0` para poder renderizar. `0` sí se emite: es un dato.
 * El descarte lo hace `metricas()`, así que la regla vive en un solo lugar.
 */
export function metrica(
  key: string,
  label: string,
  valor: number | string | null | undefined,
  format: FormatoValor,
): Metrica | null {
  if (valor === null || valor === undefined) return null;
  return { key, label, valor, format };
}

/** Arma el array `metricas` descartando las que `metrica()` resolvió como ausentes. */
export function metricas(...items: (Metrica | null)[]): Metrica[] {
  return items.filter((m): m is Metrica => m !== null);
}

/**
 * `metadata` del contrato. `truncado` compara mostrados contra el total real: con el corte a
 * `LIMITE_RESULTADOS` de las tools da lo mismo que comparar contra 50, pero además detecta
 * cualquier otro recorte previo en vez de afirmar que se mostró todo.
 */
export function metadata(
  totalResultados: number,
  resultadosMostrados: number,
): MetadataResultado {
  return {
    totalResultados,
    resultadosMostrados,
    truncado: totalResultados > resultadosMostrados,
  };
}

const builderColumna =
  (format: FormatoValor) =>
  (key: string, label: string): Columna => ({ key, label, format });

/** Builders de `Columna` por formato: `col.currency('total', 'Total')`. */
export const col = {
  currency: builderColumna('currency'),
  date: builderColumna('date'),
  number: builderColumna('number'),
  status: builderColumna('status'),
  percent: builderColumna('percent'),
  kg: builderColumna('kg'),
  un: builderColumna('un'),
  text: builderColumna('text'),
};
