import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Tope de 500 caracteres — decisión cerrada con el usuario (task `compartido/17`, 2026-09-07). */
const MAX_CARACTERES_PREGUNTA = 500;

export class ConsultarIaDto {
  @ApiProperty({
    description:
      'Pregunta en lenguaje natural sobre ventas, compras, stock, clientes, margen, caja o tesorería.',
    maxLength: MAX_CARACTERES_PREGUNTA,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CARACTERES_PREGUNTA)
  pregunta: string;
}
