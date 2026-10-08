import { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';

/**
 * Las 7 tools de la spec `compartido/17` más `obtenerEstadoCuentaCliente` y
 * `resumenProveedor` (Fase 1c, sin spec formal todavía). Sin parámetro `marca` (no existe
 * en `Producto`). `additionalProperties: false` en todas — el router (`ToolRouterService`)
 * es la allowlist real, esto es solo lo que el modelo puede pedir.
 *
 * `consultarClientes`, `consultarCaja` y `consultarTesoreria` NO llevan producto/categoría/
 * proveedor (decisión cerrada con el usuario, 2026-09-07): `Cliente`, `MovimientoCaja` y
 * `MovimientoTesoreria` no se relacionan con `Producto`. `consultarClientes` usa `cliente`
 * (nombre) en su lugar.
 *
 * Todo parámetro opcional (fuera de `required`) usa `type: ['string', 'null']`: Groq valida
 * el JSON schema server-side, y cuando el modelo omite un filtro suele mandar `null`
 * explícito en vez de no incluir la clave — con `type: 'string'` a secas esa respuesta
 * rechaza con HTTP 400 antes de llegar a `GroqService`. Las tool services ya tratan
 * `null` igual que `undefined` (chequeos truthy). Mismo motivo aplica al `enum` de
 * `tipoCliente`/`formaPago` (spec `compartido/18`): `null` va DENTRO del `enum`, no solo en
 * `type`, o la request rechaza igual.
 */
export const ERP_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'consultarVentas',
      description:
        'Consulta ventas realizadas en el ERP. Usar para cantidades vendidas, facturación, productos, categorías, historial/última venta de un cliente, detalle de una venta puntual, ranking de productos, cliente principal por facturación, ticket máximo/mínimo y comparativa contado vs. cuenta corriente.',
      parameters: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD' },
          producto: { type: ['string', 'null'] },
          categoria: { type: ['string', 'null'] },
          proveedor: { type: ['string', 'null'] },
          tipoCliente: {
            type: ['string', 'null'],
            enum: ['CF', 'EMPRESA', 'PERSONA_FISICA', null],
            description:
              'Tipo de cliente (no es la forma de pago): CF, EMPRESA o PERSONA_FISICA.',
          },
          formaPago: {
            type: ['string', 'null'],
            enum: ['CONTADO', 'CUENTA_CORRIENTE', null],
            description:
              'Forma de pago de la venta (no es el tipo de cliente): CONTADO o CUENTA_CORRIENTE.',
          },
          cliente: {
            type: ['string', 'null'],
            description: 'Nombre del cliente, para filtrar o para modo ultimaVenta.',
          },
          modo: {
            type: ['string', 'null'],
            enum: [
              'resumen',
              'ultimaVenta',
              'detalleVenta',
              'rankingProductos',
              'reporte',
              'comparativa',
              null,
            ],
            description:
              'resumen (default): totales del rango. ultimaVenta: historial de UN cliente (requiere cliente). detalleVenta: líneas de UNA venta (requiere ventaNumero). rankingProductos: productos más vendidos. reporte: ticket máximo/mínimo y cliente principal. comparativa: contado vs. cuenta corriente con %.',
          },
          ventaNumero: {
            type: ['integer', 'null'],
            description: 'Número de venta, requerido en modo detalleVenta.',
          },
          topN: {
            type: ['integer', 'null'],
            enum: [5, 10, 20, null],
            description: 'Top N ventas por importe, usado en modo reporte.',
          },
        },
        required: ['desde', 'hasta'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarCompras',
      description:
        'Consulta compras realizadas a proveedores. Usar para cuánto se compró, costo, proveedor, órdenes pendientes de pago/recepción, comparativa mercadería vs. gastos operativos, y precio de un producto por proveedor.',
      parameters: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD' },
          producto: { type: ['string', 'null'] },
          categoria: { type: ['string', 'null'] },
          proveedor: { type: ['string', 'null'] },
          modo: {
            type: ['string', 'null'],
            enum: ['resumen', 'ordenes', 'comparativa', 'precioProveedor', null],
            description:
              'resumen (default): totales del rango. ordenes: listado de órdenes filtrable por estadoPago/estadoRecepcion. comparativa: mercadería vs. gastos operativos con %. precioProveedor: precio de un producto por proveedor (requiere producto).',
          },
          estadoPago: {
            type: ['string', 'null'],
            enum: ['todos', 'pendiente', 'pagada', null],
            description: 'Filtro de estado de pago, usado en modo ordenes.',
          },
          estadoRecepcion: {
            type: ['string', 'null'],
            enum: ['todos', 'pendiente', 'parcial', 'recibida', null],
            description:
              'Filtro de estado de recepción, usado en modo ordenes.',
          },
        },
        required: ['desde', 'hasta'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarStock',
      description:
        'Consulta stock actual, productos con bajo stock, cantidades disponibles, historial ' +
        'de movimientos de un producto, % del catálogo en estado crítico, categorías con su ' +
        'cantidad de productos, y ranking de productos con más movimientos de stock.',
      parameters: {
        type: 'object',
        properties: {
          producto: {
            type: ['string', 'null'],
            description:
              'Nombre del producto. Requerido en modo historial (identifica el producto).',
          },
          categoria: { type: ['string', 'null'] },
          proveedor: { type: ['string', 'null'] },
          modo: {
            type: ['string', 'null'],
            enum: ['resumen', 'historial', 'porEstado', 'categorias', 'rotacion', null],
            description:
              'resumen (default): stock actual filtrable. historial: movimientos de UN ' +
              'producto puntual (requiere producto). porEstado: % del catálogo crítico vs. ' +
              'normal. categorias: categorías con su cantidad de productos. rotacion: ' +
              'productos con más movimientos de stock (requiere desde/hasta).',
          },
          desde: {
            type: ['string', 'null'],
            description:
              'Fecha inicial YYYY-MM-DD, usada en modo historial (opcional) y rotacion (requerida).',
          },
          hasta: {
            type: ['string', 'null'],
            description:
              'Fecha final YYYY-MM-DD, usada en modo historial (opcional) y rotacion (requerida).',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarMargen',
      description:
        'Consulta margen bruto por producto, categoría o proveedor — usa el costo histórico de cada venta cuando está disponible; queda marcado como estimado (esEstimado) si algún ítem usó el precio vigente de proveedor como fallback.',
      parameters: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD' },
          producto: { type: ['string', 'null'] },
          categoria: { type: ['string', 'null'] },
          proveedor: { type: ['string', 'null'] },
        },
        required: ['desde', 'hasta'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarClientes',
      description:
        'Vista AGREGADA del padrón de clientes: deuda total, cantidad de clientes con deuda, y comparación de ventas contado vs. cuenta corriente en un período. Para el estado de cuenta de UN cliente puntual (saldo, ventas pendientes, último movimiento) usar obtenerEstadoCuentaCliente en su lugar.',
      parameters: {
        type: 'object',
        properties: {
          cliente: {
            type: ['string', 'null'],
            description: 'Nombre del cliente',
          },
          desde: {
            type: ['string', 'null'],
            description: 'Fecha inicial YYYY-MM-DD',
          },
          hasta: {
            type: ['string', 'null'],
            description: 'Fecha final YYYY-MM-DD',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'obtenerEstadoCuentaCliente',
      description:
        'Estado de cuenta de UN cliente puntual: saldo pendiente, ventas que forman esa deuda, y último movimiento. Para una vista agregada de todo el padrón, usar consultarClientes.',
      parameters: {
        type: 'object',
        properties: {
          cliente: { type: 'string', description: 'Nombre del cliente' },
          desde: {
            type: ['string', 'null'],
            description: 'Fecha inicial YYYY-MM-DD',
          },
          hasta: {
            type: ['string', 'null'],
            description: 'Fecha final YYYY-MM-DD',
          },
        },
        required: ['cliente'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumenProveedor',
      description:
        'Resumen por proveedor: deuda actual, total comprado en un período, cantidad de órdenes y última orden. Sin proveedor, devuelve el resumen de todos. Con modo ultimaOrden y un proveedor puntual, da monto y detalle línea por línea de su última orden.',
      parameters: {
        type: 'object',
        properties: {
          proveedor: {
            type: ['string', 'null'],
            description: 'Nombre del proveedor',
          },
          desde: {
            type: ['string', 'null'],
            description: 'Fecha inicial YYYY-MM-DD',
          },
          hasta: {
            type: ['string', 'null'],
            description: 'Fecha final YYYY-MM-DD',
          },
          modo: {
            type: ['string', 'null'],
            enum: ['resumen', 'ultimaOrden', null],
            description:
              'resumen (default): resumen agregado. ultimaOrden: monto y detalle de la última orden de UN proveedor (requiere proveedor).',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reposicionStock',
      description:
        'Qué productos hay que reponer: consumo diario, cobertura y urgencia de compra. Sin desde/hasta, analiza los últimos 30 días.',
      parameters: {
        type: 'object',
        properties: {
          proveedor: {
            type: ['string', 'null'],
            description: 'Mutuamente excluyente con categoria',
          },
          categoria: {
            type: ['string', 'null'],
            description: 'Mutuamente excluyente con proveedor',
          },
          producto: {
            type: ['string', 'null'],
            description:
              'Acota la reposición a un producto puntual. Se puede combinar con proveedor o categoria.',
          },
          diasCubrir: {
            type: ['integer', 'null'],
            enum: [15, 30, 60, null],
            description: 'Días de cobertura objetivo. Default 15.',
          },
          desde: {
            type: ['string', 'null'],
            description: 'Fecha inicial YYYY-MM-DD del análisis de consumo',
          },
          hasta: {
            type: ['string', 'null'],
            description: 'Fecha final YYYY-MM-DD del análisis de consumo',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarCaja',
      description:
        'Consulta caja diaria: ingresos, egresos, sesiones (apertura/cierre), fondos disponibles (Caja Diaria + Tesorería) y desglose por medio de pago en un rango de fechas; detalle de una sesión puntual; y si hay una sesión de caja abierta ahora mismo, con su monto inicial y hora de apertura.',
      parameters: {
        type: 'object',
        properties: {
          desde: {
            type: ['string', 'null'],
            description:
              'Fecha inicial YYYY-MM-DD. No requerido en modo sesionActual.',
          },
          hasta: {
            type: ['string', 'null'],
            description:
              'Fecha final YYYY-MM-DD. No requerido en modo sesionActual.',
          },
          modo: {
            type: ['string', 'null'],
            enum: ['resumen', 'sesiones', 'sesionActual', null],
            description:
              'resumen (default): totales del rango, con desglose por medio de pago. sesiones: listado de sesiones cerradas del rango, o detalle de UNA sesión puntual si se pasa sesionNumero. sesionActual: si hay una sesión de caja abierta ahora mismo, con monto inicial y hora de apertura (no usa desde/hasta).',
          },
          sesionNumero: {
            type: ['integer', 'null'],
            description:
              'Número de sesión puntual, usado en modo sesiones junto con desde/hasta para acotar su fecha.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarTesoreria',
      description:
        'Consulta el consolidado de tesorería: ingresos y egresos, desglose efectivo vs. bancos, evolución día por día, y listado de movimientos individuales en un rango de fechas.',
      parameters: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD' },
          modo: {
            type: ['string', 'null'],
            enum: ['resumen', 'porFecha', 'movimientos', null],
            description:
              'resumen (default): totales del rango, con desglose efectivo vs. bancos. porFecha: evolución día por día (ingresos/egresos). movimientos: listado de movimientos individuales de Tesorería.',
          },
        },
        required: ['desde', 'hasta'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarListasPrecio',
      description:
        'Consulta listas de precio de venta a clientes: qué listas existen y cuántos productos/clientes tiene cada una, qué listas tiene asignadas UN cliente puntual y cuál es su automática, y a qué precio está un producto en cada lista (o en la lista/cliente indicado).',
      parameters: {
        type: 'object',
        properties: {
          modo: {
            type: ['string', 'null'],
            enum: ['resumen', 'porCliente', 'producto', null],
            description:
              'resumen (default): todas las listas con cantidad de productos y clientes. porCliente: listas asignadas a UN cliente (requiere cliente), marcando cuál es la automática. producto: precio de UN producto (requiere producto) en todas las listas donde aparece, o acotado por lista o por cliente.',
          },
          cliente: {
            type: ['string', 'null'],
            description:
              'Nombre del cliente. Requerido en modo porCliente. Opcional en modo producto (cruza con sus listas asignadas, ignorado si además se pasa lista).',
          },
          producto: {
            type: ['string', 'null'],
            description: 'Nombre del producto, requerido en modo producto.',
          },
          lista: {
            type: ['string', 'null'],
            description:
              'Nombre de la lista de precios, opcional en modo producto para acotar a esa lista.',
          },
        },
        additionalProperties: false,
      },
    },
  },
];
