import { Injectable } from '@nestjs/common';
import { ConsultarIaDto } from './dto/consultar-ia.dto';
import {
  GroqService,
  MENSAJE_LOOP_AGOTADO,
  ResultadoConsultaIa,
} from './groq/groq.service';
import { IaQuotaService } from './quota/ia-quota.service';
import { IaUsageService } from './usage/ia-usage.service';

/** Único workflow de este módulo hoy — etiqueta fija de trazabilidad en `ConsumoIa.workflow`. */
const WORKFLOW_CONSULTAR_IA = 'consultar-ia';

/**
 * Orquesta `POST /ia/consultar` (spec `compartido/20`): reserva cupo (INSERT `ConsumoIa`
 * `PENDIENTE`) ANTES de llamar a Groq — con cupo agotado, `GroqService.consultar()` nunca se
 * invoca. El registro de consumo se completa siempre, tanto en éxito como en error de Groq (la
 * cuota ya se consumió con el INSERT, no se revierte).
 */
@Injectable()
export class IaService {
  constructor(
    private readonly groqService: GroqService,
    private readonly quotaService: IaQuotaService,
    private readonly usageService: IaUsageService,
  ) {}

  async consultar(
    dto: ConsultarIaDto,
    usuarioId: string,
  ): Promise<ResultadoConsultaIa> {
    const consumoIaId = await this.quotaService.reservar(usuarioId);
    const inicio = Date.now();

    try {
      const resultado = await this.groqService.consultar(dto.pregunta);
      await this.usageService.registrar(consumoIaId, {
        modelo: resultado.modeloUsado,
        inputTokens: resultado.inputTokens,
        outputTokens: resultado.outputTokens,
        totalTokens: resultado.totalTokens,
        cantidadToolCalls: resultado.cantidadToolCalls,
        iteraciones: resultado.iteraciones,
        duracionMs: Date.now() - inicio,
        resultado:
          resultado.respuesta === MENSAJE_LOOP_AGOTADO ? 'LOOP_AGOTADO' : 'OK',
        workflow: WORKFLOW_CONSULTAR_IA,
        tools: resultado.consultasUtilizadas.map((c) => c.tool).join(','),
      });
      return resultado;
    } catch (error) {
      await this.usageService.registrar(consumoIaId, {
        modelo: '',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cantidadToolCalls: 0,
        iteraciones: 0,
        duracionMs: Date.now() - inicio,
        resultado: 'ERROR_GROQ',
        workflow: WORKFLOW_CONSULTAR_IA,
      });
      throw error;
    }
  }
}
