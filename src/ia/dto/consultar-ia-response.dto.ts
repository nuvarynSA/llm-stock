import { ApiProperty } from '@nestjs/swagger';

/** "Consulta utilizada" (spec `compartido/17`, sección Frontend) — para que el usuario pueda auditar de dónde salió el número. */
export class ConsultaUtilizadaDto {
  @ApiProperty({
    description: 'Nombre de la tool ejecutada (ej. consultarVentas).',
  })
  tool: string;

  @ApiProperty({
    description: 'Argumentos con los que el modelo llamó a la tool.',
  })
  argumentos: unknown;

  @ApiProperty({
    description:
      'Resultado crudo devuelto por la tool (el mismo que se le pasó al modelo como contexto), para que el frontend pueda auditar o renderizar los datos reales. Incluye, además de los campos de dominio de cada tool, el contrato de presentación de la spec `compartido/22` (`resumen?`/`metricas`/`columnas`/`filas`/`metadata`) — tipos en `ia/presentacion/presentacion.ts`.',
  })
  resultado: unknown;
}

export class ConsultarIaResponseDto {
  @ApiProperty({
    description:
      'Respuesta en prosa, generada por el modelo a partir de los resultados de las tools.',
  })
  respuesta: string;

  @ApiProperty({ type: [ConsultaUtilizadaDto] })
  consultasUtilizadas: ConsultaUtilizadaDto[];

  @ApiProperty({
    description:
      'Modelo de Groq que generó la respuesta final (spec `compartido/17`, fallback 2026-09-07).',
    example: 'openai/gpt-oss-120b',
  })
  modeloUsado: string;
}
