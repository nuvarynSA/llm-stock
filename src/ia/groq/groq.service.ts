import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq, { APIError, RateLimitError } from 'groq-sdk';
import {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'groq-sdk/resources/chat/completions';
import { ERP_TOOLS } from '../tools/erp-tools';
import { ToolRouterService } from '../tools/tool-router.service';
import { GroqRateLimitError, GroqUnavailableError } from './groq-errors';

export interface ConsultaUtilizada {
  tool: string;
  argumentos: unknown;
  resultado: unknown;
}

export interface ResultadoConsultaIa {
  respuesta: string;
  consultasUtilizadas: ConsultaUtilizada[];
  modeloUsado: string;
  /** Suma de `usage.prompt_tokens` de todas las llamadas a Groq del loop (spec `compartido/20`). */
  inputTokens: number;
  /** Suma de `usage.completion_tokens` de todas las llamadas a Groq del loop. */
  outputTokens: number;
  /** Suma de `usage.total_tokens` de todas las llamadas a Groq del loop. */
  totalTokens: number;
  /** Número de iteración del loop en la que se resolvió (o se agotó) la consulta, 1 a `MAX_ITERACIONES`. */
  iteraciones: number;
  /** Cantidad total de tool_calls ejecutadas en la consulta (`consultasUtilizadas.length`). */
  cantidadToolCalls: number;
}

// Límites duros de la spec `compartido/17` — no configurables por env, son parte del diseño.
const MAX_ITERACIONES = 3;
const GROQ_TIMEOUT_MS = 15_000;
// Decisión técnica (no regla de negocio documentada): acota la respuesta final para no
// quemar el presupuesto de TPM del tier gratuito con una respuesta desbocada.
const MAX_COMPLETION_TOKENS = 1024;

const SYSTEM_PROMPT =
  'Respondé siempre en español rioplatense. Usá formato es-AR para números y moneda ' +
  '($1.234,56). Solo podés responder preguntas de ventas, compras, stock, clientes, margen, ' +
  'caja o tesorería usando las tools disponibles. Si la pregunta no entra en esos temas, o no ' +
  'hay tool que la resuelva, decilo explícitamente en vez de inventar una respuesta. ' +
  'Podés responder sobre estos ejes usando las tools: período (ej. "¿Cuánto vendí en ' +
  'total esta semana?"), producto (ej. "¿Cuántos kilos vendí de Muzzarella entre el ' +
  '01/08/2026 y el 15/08/2026?"), categoría (ej. "¿Cuánto vendí de la categoría Lácteos ' +
  'en agosto?"), proveedor (ej. "¿Cuánto le compré al proveedor Dicaro este mes?"), ' +
  'cliente (ej. "¿Qué clientes tienen deuda pendiente?"), tipo de cliente (ej. "¿Cuánto ' +
  'facturé en ventas de contado (CF) el mes pasado?") y forma de pago (ej. "¿Cuánto ' +
  'vendí de contado vs. cuenta corriente en agosto?"). También podés dar el estado de ' +
  'cuenta de un cliente puntual (ej. "¿Cuánto me debe el cliente Kiosco Gral Paz?"), qué ' +
  'stock reponer (ej. "¿Qué productos tengo que comprar urgente esta semana?") y el ' +
  'resumen de un proveedor (ej. "¿Cuánto le debo al proveedor Dicaro?"). También podés dar ' +
  'la última venta o historial de un cliente puntual con monto (ej. "¿Cuál fue la última ' +
  'venta del cliente Almacén Natural?"), el detalle línea por línea de una venta por número ' +
  '(ej. "¿Qué productos tiene la venta 105?"), el ranking de productos más vendidos, el ' +
  'cliente principal por facturación, ticket máximo/mínimo y top ventas por importe, y la ' +
  'comparativa contado vs. cuenta corriente con porcentaje de participación. En compras, ' +
  'también podés dar el monto y detalle de la última orden a un proveedor puntual (ej. ' +
  '"¿Cuál fue la última compra al proveedor Dicaro?"), el listado de órdenes pendientes de ' +
  'pago o de recepción (ej. "¿Qué órdenes tengo pendientes de pagar?"), la comparativa entre ' +
  'compras de mercadería y gastos operativos con porcentaje de participación, y el precio de ' +
  'un producto por proveedor o su comparativa entre proveedores (ej. "¿A qué precio me vende ' +
  'Muzzarella cada proveedor?"). En stock, también podés dar el historial de movimientos de ' +
  'un producto puntual (ej. "¿Qué movimientos tuvo el stock de Muzzarella?"), reponer un ' +
  'producto puntual, el % del catálogo en estado crítico vs. normal, las categorías con su ' +
  'cantidad de productos, y el ranking de productos con más movimientos de stock. En caja, ' +
  'también podés dar el desglose por medio de pago (efectivo/tarjeta/transferencia), el ' +
  'detalle de una sesión puntual (horarios, medios de pago) o el listado de sesiones ' +
  'cerradas de un período, y si hay una caja abierta ahora mismo con su monto inicial y ' +
  'hora de apertura (ej. "¿Hay caja abierta ahora?"). En tesorería, también podés dar el ' +
  'desglose efectivo vs. bancos, la evolución día por día de ingresos y egresos, y el ' +
  'listado de movimientos individuales (ej. "¿Qué movimientos tuvo Tesorería esta semana?"). ' +
  'También podés dar las listas de precio existentes con su cantidad de productos y ' +
  'clientes, las listas asignadas a un cliente puntual con cuál es la automática, y a qué ' +
  'precio está un producto en cada lista (ej. "¿A cuánto está la harina 000 en la lista ' +
  'Mayorista?"). ' +
  'Si la pregunta ' +
  'no corresponde a ninguno de estos ejes ni a las tools disponibles (por ejemplo, ' +
  'ventas por vendedor o empleado, o cualquier dato que el ERP no gestione), no ' +
  'ejecutes ninguna tool: decí explícitamente qué no podés analizar y ofrecé 2 o 3 ' +
  'capacidades cercanas de las que sí tenés, con un ejemplo concreto de pregunta que sí ' +
  'podés responder. Esto es distinto de cuando una tool SÍ aplica pero no encuentra ' +
  'datos (resultado con sinResultados: true): ahí la capacidad existe, no ofrezcas ' +
  'capacidades alternativas — explicá que no se encontraron datos en ese recorte de ' +
  'fechas o filtros y sugerí ampliarlo o aflojarlos. Nunca calcules ni asumas números ' +
  'que no vengan de una tool. Respondé exactamente lo que se ' +
  'pidió: si la pregunta es "cuántos", "cantidad" o "total", el número va primero, sin ' +
  'listar los registros individuales uno por uno. Nunca armes tablas ni bloques de código ' +
  'Markdown en la respuesta, ni uses ningún marcador Markdown (asteriscos, guiones bajos, ' +
  'almohadillas, backticks): se muestra como texto plano, y el detalle de los registros ya ' +
  'lo muestra un panel estructurado aparte en el frontend. ' +
  'Mantené la prosa breve (1 a 3 oraciones): el detalle ' +
  'vive en la tabla o las métricas del frontend, no en el texto. Si el resultado de una ' +
  'tool trae total mayor que limit, avisá que hay más coincidencias que las mostradas y ' +
  'sugerí acotar la búsqueda con filtros (categoría, producto, proveedor o cliente según ' +
  'corresponda), sin listar ni resumir individualmente los registros que no se cargaron. ' +
  'Cuando el usuario escriba una fecha como DD-MM-YYYY o DD/MM/YYYY, tratalas como ' +
  'equivalentes: son el mismo formato con distinto separador, convertilas igual a ' +
  'YYYY-MM-DD para los argumentos de la tool.';

/** Exportado para que `IaService` distinga `resultado: 'LOOP_AGOTADO'` de `'OK'` sin duplicar el texto. */
export const MENSAJE_LOOP_AGOTADO =
  'No pude resolver tu consulta en la cantidad de pasos permitidos. Probá con una pregunta más específica.';

/**
 * Loop de tool-calling (spec `compartido/17`): manda `ERP_TOOLS` a Groq, ejecuta las tools
 * que pida vía `ToolRouterService` (allowlist), y le devuelve el resultado hasta que el
 * modelo responda en prosa o se agoten las `MAX_ITERACIONES`. Nunca genera SQL ni accede a
 * la base directamente.
 */
@Injectable()
export class GroqService {
  private readonly client: Groq;
  // Lista de fallback (spec `compartido/17`, decisión 2026-09-07): sin `GROQ_MODELS`, solo
  // contiene `GROQ_MODEL` y el comportamiento es idéntico al de un único modelo fijo.
  private readonly modelos: string[];

  constructor(
    private readonly config: ConfigService,
    private readonly toolRouter: ToolRouterService,
  ) {
    this.client = new Groq({
      apiKey: this.config.get<string>('GROQ_API_KEY'),
    });
    const modelosEnv = this.config.get<string>('GROQ_MODELS');
    this.modelos = modelosEnv
      ? modelosEnv
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean)
      : [this.config.get<string>('GROQ_MODEL')!];
  }

  async consultar(pregunta: string): Promise<ResultadoConsultaIa> {
    const inicio = Date.now();
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: pregunta },
    ];
    const consultasUtilizadas: ConsultaUtilizada[] = [];
    let tokensAcumulados = 0;
    let inputTokensAcumulados = 0;
    let outputTokensAcumulados = 0;
    // Arranca en el primer modelo de la lista en cada consulta (no es "pegajoso" entre
    // consultas distintas). Si un 429 lo hace avanzar, las iteraciones siguientes de ESTA
    // consulta siguen desde ese mismo índice en vez de reintentar el modelo #1 cada vez.
    let indiceModeloActual = 0;

    for (let iteracion = 1; iteracion <= MAX_ITERACIONES; iteracion++) {
      const { completion, indiceModelo } = await this.llamarGroq(
        messages,
        indiceModeloActual,
      );
      indiceModeloActual = indiceModelo;
      const modeloUsado = this.modelos[indiceModelo];
      tokensAcumulados += completion.usage?.total_tokens ?? 0;
      inputTokensAcumulados += completion.usage?.prompt_tokens ?? 0;
      outputTokensAcumulados += completion.usage?.completion_tokens ?? 0;
      const mensaje = completion.choices[0].message;
      messages.push(mensaje);

      if (!mensaje.tool_calls?.length) {
        this.logResultado(
          pregunta,
          consultasUtilizadas,
          inicio,
          tokensAcumulados,
        );
        return {
          respuesta: mensaje.content ?? '',
          consultasUtilizadas,
          modeloUsado,
          inputTokens: inputTokensAcumulados,
          outputTokens: outputTokensAcumulados,
          totalTokens: tokensAcumulados,
          iteraciones: iteracion,
          cantidadToolCalls: consultasUtilizadas.length,
        };
      }

      if (iteracion === MAX_ITERACIONES) {
        this.logResultado(
          pregunta,
          consultasUtilizadas,
          inicio,
          tokensAcumulados,
        );
        return {
          respuesta: MENSAJE_LOOP_AGOTADO,
          consultasUtilizadas,
          modeloUsado,
          inputTokens: inputTokensAcumulados,
          outputTokens: outputTokensAcumulados,
          totalTokens: tokensAcumulados,
          iteraciones: iteracion,
          cantidadToolCalls: consultasUtilizadas.length,
        };
      }

      const resultados = await Promise.all(
        mensaje.tool_calls.map(async (toolCall) => {
          const argumentos = this.parsearArgumentos(
            toolCall.function.arguments,
          );
          try {
            const resultado = await this.toolRouter.ejecutar(
              toolCall.function.name,
              argumentos,
            );
            return { toolCall, argumentos, resultado };
          } catch (error) {
            return {
              toolCall,
              argumentos,
              resultado: {
                error:
                  error instanceof Error
                    ? error.message
                    : 'Error ejecutando la tool.',
              },
            };
          }
        }),
      );

      for (const { toolCall, argumentos, resultado } of resultados) {
        consultasUtilizadas.push({
          tool: toolCall.function.name,
          argumentos,
          resultado,
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(resultado),
        });
      }
    }

    // Inalcanzable: el for siempre retorna en iteracion === MAX_ITERACIONES.
    throw new GroqUnavailableError('Loop de tool-calling sin resolver.');
  }

  /**
   * Prueba los modelos de `this.modelos` en orden, empezando en `indiceInicial`. Un 429 pasa
   * al siguiente modelo de la lista en vez de propagarse; si TODOS los restantes también
   * responden 429, propaga un único `GroqRateLimitError` (el `retryAfter` del último
   * intento) — nunca una excepción cruda de la SDK.
   */
  private async llamarGroq(
    messages: ChatCompletionMessageParam[],
    indiceInicial: number,
  ): Promise<{ completion: ChatCompletion; indiceModelo: number }> {
    let ultimoRetryAfter: number | null = null;

    for (let i = indiceInicial; i < this.modelos.length; i++) {
      try {
        const completion = await this.client.chat.completions.create(
          {
            model: this.modelos[i],
            messages,
            tools: ERP_TOOLS,
            temperature: 0,
            max_completion_tokens: MAX_COMPLETION_TOKENS,
            parallel_tool_calls: true,
          },
          { timeout: GROQ_TIMEOUT_MS },
        );
        return { completion, indiceModelo: i };
      } catch (error) {
        if (error instanceof RateLimitError) {
          const retryAfterHeader = error.headers?.get('retry-after');
          ultimoRetryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
          continue;
        }
        if (error instanceof APIError) {
          throw new GroqUnavailableError(error.message);
        }
        throw error;
      }
    }

    throw new GroqRateLimitError(ultimoRetryAfter);
  }

  private parsearArgumentos(argumentos: string): unknown {
    try {
      return JSON.parse(argumentos);
    } catch {
      return {};
    }
  }

  /**
   * `console.log`, no el `Logger` de Nest: `main.ts` arranca la app con `logger: false`
   * (mismo criterio ya documentado en `BrevoEmailService`), lo que también silencia el
   * `Logger` inyectable en dev/producción.
   *
   * `tokens` es la SUMA de `usage.total_tokens` de todas las llamadas a Groq del loop
   * (una consulta con tool_calls hace 2+ llamadas reales) — nunca solo la de la última,
   * porque el tier gratuito se mide en TPM y loguear solo la última subestima el consumo
   * real (Fase 4 de la task `compartido/17`).
   */
  private logResultado(
    pregunta: string,
    consultasUtilizadas: ConsultaUtilizada[],
    inicio: number,
    tokensAcumulados: number,
  ): void {
    console.log(
      JSON.stringify({
        modulo: 'ia',
        pregunta,
        tools: consultasUtilizadas.map((c) => ({
          tool: c.tool,
          argumentos: c.argumentos,
        })),
        duracionMs: Date.now() - inicio,
        tokens: tokensAcumulados,
      }),
    );
  }
}
