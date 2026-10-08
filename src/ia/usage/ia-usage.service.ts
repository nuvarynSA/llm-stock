import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { precioDe } from './precios-modelo';

export interface DatosConsumoIa {
  modelo: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cantidadToolCalls: number;
  iteraciones: number;
  duracionMs: number;
  resultado: string;
  workflow?: string;
  tools?: string;
}

/**
 * Completa la fila `ConsumoIa` reservada por `IaQuotaService.reservar()` (spec `compartido/20`)
 * con el resultado real de la consulta — la fila ya existe en estado `PENDIENTE` antes de
 * llamar a este service, `registrar()` solo la actualiza.
 */
@Injectable()
export class IaUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(consumoIaId: string, datos: DatosConsumoIa): Promise<void> {
    const costoUsd = this.calcularCosto(
      datos.modelo,
      datos.inputTokens,
      datos.outputTokens,
    );

    await this.prisma.consumoIa.update({
      where: { id: consumoIaId },
      data: {
        modelo: datos.modelo,
        inputTokens: datos.inputTokens,
        outputTokens: datos.outputTokens,
        totalTokens: datos.totalTokens,
        cantidadToolCalls: datos.cantidadToolCalls,
        iteraciones: datos.iteraciones,
        duracionMs: datos.duracionMs,
        resultado: datos.resultado,
        workflow: datos.workflow,
        tools: datos.tools,
        costoUsd,
      },
    });
  }

  /** Costo en USD = tokens × precio/millón, sumado input + output. Nunca se trunca a `Number`. */
  calcularCosto(
    modelo: string,
    inputTokens: number,
    outputTokens: number,
  ): Prisma.Decimal {
    const { inputPorMillion, outputPorMillion } = precioDe(modelo);
    const UN_MILLON = 1_000_000;

    const costoInput = inputPorMillion.mul(inputTokens).div(UN_MILLON);
    const costoOutput = outputPorMillion.mul(outputTokens).div(UN_MILLON);

    return costoInput.add(costoOutput);
  }
}
