import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  ServiceUnavailableException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../login/decorators/current-user.decorator';
import type { JwtPayload } from '../login/interfaces/jwt-payload.interface';
import { ConsultarIaResponseDto } from './dto/consultar-ia-response.dto';
import { ConsultarIaDto } from './dto/consultar-ia.dto';
import { CuotaIaResponseDto } from './dto/cuota-ia-response.dto';
import { IaThrottlerGuard } from './guards/ia-throttler.guard';
import {
  GroqRateLimitError,
  GroqUnavailableError,
  IaQuotaExceededError,
} from './groq/groq-errors';
import { IaService } from './ia.service';
import { IaQuotaService } from './quota/ia-quota.service';

// Decisión cerrada con el usuario (task `compartido/20`, 2026-09-09): sube de 2 a 3 consultas
// por minuto por usuario (`IA_RATE_LIMIT_PER_MINUTE`). `@Throttle` se evalúa al cargar el
// módulo, antes de que `ConfigService` esté disponible — se lee `process.env` directo en vez
// de inyectar `ConfigService` acá (documentado, ver reporte de la fase).
const LIMITE_POR_MINUTO = Number(process.env.IA_RATE_LIMIT_PER_MINUTE ?? 3);
const THROTTLE_IA = { default: { limit: LIMITE_POR_MINUTO, ttl: 60_000 } };

@ApiTags('IA')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(IaThrottlerGuard)
@Throttle(THROTTLE_IA)
@Controller('ia')
export class IaController {
  constructor(
    private readonly iaService: IaService,
    private readonly quotaService: IaQuotaService,
  ) {}

  @Post('consultar')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Responder en lenguaje natural preguntas de ventas, compras, stock, clientes, margen, caja o tesorería (spec compartido/17)',
  })
  @ApiBody({ type: ConsultarIaDto })
  @ApiResponse({ status: 200, description: 'OK', type: ConsultarIaResponseDto })
  @ApiResponse({
    status: 429,
    description:
      'Límite de consultas alcanzado (propio por minuto, cuota diaria/mensual, o de Groq).',
  })
  @ApiResponse({
    status: 503,
    description: 'El servicio de consultas no está disponible.',
  })
  async consultar(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConsultarIaDto,
  ): Promise<ConsultarIaResponseDto> {
    try {
      const resultado = await this.iaService.consultar(dto, user.sub);
      return {
        respuesta: resultado.respuesta,
        consultasUtilizadas: resultado.consultasUtilizadas,
        modeloUsado: resultado.modeloUsado,
      };
    } catch (error) {
      if (error instanceof IaQuotaExceededError) {
        throw new HttpException(
          {
            code: 'IA_QUOTA_EXCEEDED',
            type: error.type,
            used: error.used,
            limit: error.limit,
            resetAt: error.resetAt,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error instanceof GroqRateLimitError) {
        throw new HttpException(
          {
            message: `Se alcanzó el límite de consultas, probá de nuevo en ${
              error.retryAfter ?? 60
            }s`,
            retryAfter: error.retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error instanceof GroqUnavailableError) {
        throw new ServiceUnavailableException(
          'El servicio de consultas no está disponible, probá más tarde',
        );
      }
      throw error;
    }
  }

  @Get('cuota')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Estado actual de la cuota GLOBAL de IA (diaria, mensual y presupuesto) sin consumirla (spec compartido/20)',
  })
  @ApiResponse({ status: 200, description: 'OK', type: CuotaIaResponseDto })
  async cuota(): Promise<CuotaIaResponseDto> {
    return this.quotaService.estado();
  }
}
