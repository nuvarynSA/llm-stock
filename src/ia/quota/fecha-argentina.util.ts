/**
 * Límites de día/mes de `IaQuotaService` (spec `compartido/20`) en horario de Argentina
 * (`America/Argentina/Buenos_Aires`, UTC-3 fijo, sin horario de verano — mismo criterio que
 * `caja.util.ts:formatHora`). A diferencia de ese archivo (que muestra horas ya guardadas),
 * acá se CALCULAN los límites `gte`/`lt` de las queries de cuota, por eso el offset se aplica
 * a mano en vez de `Intl.DateTimeFormat` (que solo formatea, no devuelve un `Date` desplazado).
 */
const OFFSET_HORAS_ARGENTINA = -3;
const MS_POR_HORA = 60 * 60 * 1000;

function componentesEnArgentina(fecha: Date): {
  anio: number;
  mes: number;
  dia: number;
} {
  const desplazada = new Date(
    fecha.getTime() + OFFSET_HORAS_ARGENTINA * MS_POR_HORA,
  );
  return {
    anio: desplazada.getUTCFullYear(),
    mes: desplazada.getUTCMonth(),
    dia: desplazada.getUTCDate(),
  };
}

/** Instante UTC que corresponde a las 00:00 de "hoy" en Argentina. */
export function inicioDiaArgentina(fecha: Date = new Date()): Date {
  const { anio, mes, dia } = componentesEnArgentina(fecha);
  return new Date(Date.UTC(anio, mes, dia, -OFFSET_HORAS_ARGENTINA, 0, 0, 0));
}

/** Instante UTC que corresponde a las 00:00 de mañana en Argentina (exclusivo, para `lt`). */
export function inicioDiaSiguienteArgentina(fecha: Date = new Date()): Date {
  return new Date(inicioDiaArgentina(fecha).getTime() + 24 * MS_POR_HORA);
}

/** Instante UTC que corresponde al día 1 del mes actual, 00:00, en Argentina. */
export function inicioMesArgentina(fecha: Date = new Date()): Date {
  const { anio, mes } = componentesEnArgentina(fecha);
  return new Date(Date.UTC(anio, mes, 1, -OFFSET_HORAS_ARGENTINA, 0, 0, 0));
}

/** Instante UTC que corresponde al día 1 del mes siguiente, 00:00, en Argentina (exclusivo, para `lt`). */
export function inicioMesSiguienteArgentina(fecha: Date = new Date()): Date {
  const { anio, mes } = componentesEnArgentina(fecha);
  return new Date(Date.UTC(anio, mes + 1, 1, -OFFSET_HORAS_ARGENTINA, 0, 0, 0));
}

/** Formatea un instante UTC como ISO con el offset fijo `-03:00` (para el `resetAt` de la cuota). */
export function isoConOffsetArgentina(fecha: Date): string {
  const desplazada = new Date(
    fecha.getTime() + OFFSET_HORAS_ARGENTINA * MS_POR_HORA,
  );
  const pad = (valor: number, longitud = 2) =>
    String(valor).padStart(longitud, '0');

  const anio = desplazada.getUTCFullYear();
  const mes = pad(desplazada.getUTCMonth() + 1);
  const dia = pad(desplazada.getUTCDate());
  const hora = pad(desplazada.getUTCHours());
  const minuto = pad(desplazada.getUTCMinutes());
  const segundo = pad(desplazada.getUTCSeconds());
  const ms = pad(desplazada.getUTCMilliseconds(), 3);

  return `${anio}-${mes}-${dia}T${hora}:${minuto}:${segundo}.${ms}-03:00`;
}
