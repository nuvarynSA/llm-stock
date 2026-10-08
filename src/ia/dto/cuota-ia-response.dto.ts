import { ApiProperty } from '@nestjs/swagger';

class VentanaCuotaDto {
  @ApiProperty({
    description: 'Consultas ya utilizadas en la ventana vigente.',
  })
  usado: number;

  @ApiProperty({
    description: 'Tope de consultas para la ventana (spec `compartido/20`).',
  })
  limite: number;

  @ApiProperty({
    description:
      'Instante en que la ventana se resetea, en horario de Argentina (offset -03:00).',
    example: '2026-09-10T00:00:00.000-03:00',
  })
  resetAt: string;
}

class PresupuestoCuotaDto {
  @ApiProperty({ description: 'Costo en USD acumulado en el mes actual.' })
  usadoUsd: number;

  @ApiProperty({
    description:
      'Tope de presupuesto mensual en USD (`IA_MONTHLY_BUDGET_USD`).',
  })
  limiteUsd: number;
}

/** Respuesta de `GET /ia/cuota` (spec `compartido/20`) — estado actual, sin consumir cupo. */
export class CuotaIaResponseDto {
  @ApiProperty({ type: VentanaCuotaDto })
  diario: VentanaCuotaDto;

  @ApiProperty({ type: VentanaCuotaDto })
  mensual: VentanaCuotaDto;

  @ApiProperty({ type: PresupuestoCuotaDto })
  presupuesto: PresupuestoCuotaDto;
}
