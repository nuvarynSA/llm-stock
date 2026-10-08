/**
 * Helper compartido por las suites `contrato-presentacion.*.spec.ts` (spec `compartido/22`).
 * Regla del usuario (2026-09-09): con 27 modos en total, NO se testea 5-10 veces por modo —
 * una única tabla `it.each`, repartida en varios archivos por familia de tool para no pasar
 * 200-250 líneas, verifica UNA vez el contrato invariante (emite los 4 campos, conserva los
 * campos de dominio previos, `metadata` bien formada, ninguna métrica quedó en `null`).
 *
 * La relevancia de métricas y la forma puntual de `filas`/`columnas` de cada modo ya están
 * cubiertas en el spec del tool correspondiente (`*.tool*.spec.ts`) — acá no se repite.
 */
export type Caso = {
  nombre: string;
  campoDominio: string;
  ejecutar: () => Promise<unknown>;
};

export function testearContratoInvariante(descripcion: string, casos: Caso[]) {
  describe(descripcion, () => {
    it.each(casos.map((c): [string, Caso] => [c.nombre, c]))(
      '%s emite el contrato invariante y conserva sus campos de dominio',
      async (_nombre, caso) => {
        const resultado = (await caso.ejecutar()) as Record<string, unknown>;

        expect(Array.isArray(resultado.metricas)).toBe(true);
        expect(Array.isArray(resultado.columnas)).toBe(true);
        expect(Array.isArray(resultado.filas)).toBe(true);
        expect(resultado.metadata).toEqual({
          totalResultados: expect.any(Number),
          resultadosMostrados: expect.any(Number),
          truncado: expect.any(Boolean),
        });
        // Campo de dominio previo a la spec compartido/22, que sigue existiendo (aditivo).
        expect(resultado[caso.campoDominio]).not.toBeUndefined();
        // Ninguna métrica quedó con `null`/`undefined` convertido en placeholder.
        for (const metrica of resultado.metricas as { valor: unknown }[]) {
          expect(metrica.valor === null || metrica.valor === undefined).toBe(
            false,
          );
        }
      },
    );
  });
}
