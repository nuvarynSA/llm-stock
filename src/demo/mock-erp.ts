/**
 * In-memory ERP dataset + mock tool router for the self-contained demo.
 *
 * WHAT IS REAL vs. MOCKED
 * -----------------------
 * The production module (`src/ia`) backs every tool with Prisma queries over the real ERP
 * PostgreSQL database. That database cannot ship in a public showcase, so this file replaces
 * ONLY the data layer: it implements the same `ejecutar(nombre, args)` contract that the
 * production `ToolRouterService` exposes (see `src/ia/tools/tool-router.service.ts`) and
 * returns the same presentation contract (`metricas` / `columnas` / `filas` / `metadata`,
 * see `src/ia/presentacion/presentacion.ts`, imported verbatim below).
 *
 * The LLM tool-calling loop that drives these tools (`src/demo/groq-loop.ts`) is a faithful
 * copy of the production `GroqService`. The dataset below is a small, deterministic
 * dairy-distributor fixture so the demo answers real questions over real date filters.
 */
import {
  col,
  Columna,
  Fila,
  metadata,
  metrica,
  metricas,
  ResultadoPresentable,
} from '../ia/presentacion/presentacion';

// ---------------------------------------------------------------------------
// Seeded dataset ("Lácteos Los Hermanos" — mayorista de lácteos y almacén)
// ---------------------------------------------------------------------------

type Unidad = 'KG' | 'UNIDAD';
type TipoCliente = 'CF' | 'EMPRESA' | 'PERSONA_FISICA';
type FormaPago = 'CONTADO' | 'CUENTA_CORRIENTE';

interface Producto {
  nombre: string;
  categoria: string;
  proveedor: string;
  unidad: Unidad;
  stockActual: number;
  stockCritico: number;
  precioVenta: number;
  costo: number;
}

interface ItemVenta {
  producto: string;
  cantidad: number;
  precioUnitario: number;
}

interface Venta {
  numero: number;
  fecha: string; // YYYY-MM-DD
  clienteNombre: string;
  tipoCliente: TipoCliente;
  formaPago: FormaPago;
  items: ItemVenta[];
}

interface Cliente {
  nombre: string;
  tipo: TipoCliente;
  saldo: number; // deuda pendiente
}

interface Proveedor {
  nombre: string;
  deuda: number;
  totalComprado: number;
  ordenes: number;
  ultimaOrdenFecha: string;
}

const PRODUCTOS: Producto[] = [
  { nombre: 'Muzzarella', categoria: 'Lácteos', proveedor: 'Dicaro', unidad: 'KG', stockActual: 18, stockCritico: 40, precioVenta: 6200, costo: 4300 },
  { nombre: 'Queso Cremoso', categoria: 'Lácteos', proveedor: 'Dicaro', unidad: 'KG', stockActual: 52, stockCritico: 30, precioVenta: 5800, costo: 4000 },
  { nombre: 'Dulce de Leche', categoria: 'Lácteos', proveedor: 'La Serenísima', unidad: 'KG', stockActual: 9, stockCritico: 25, precioVenta: 4200, costo: 2800 },
  { nombre: 'Manteca', categoria: 'Lácteos', proveedor: 'La Serenísima', unidad: 'KG', stockActual: 30, stockCritico: 20, precioVenta: 7100, costo: 5200 },
  { nombre: 'Harina 000', categoria: 'Almacén', proveedor: 'Molinos', unidad: 'KG', stockActual: 120, stockCritico: 60, precioVenta: 980, costo: 620 },
  { nombre: 'Aceite Girasol', categoria: 'Almacén', proveedor: 'Molinos', unidad: 'UNIDAD', stockActual: 14, stockCritico: 48, precioVenta: 2600, costo: 1850 },
  { nombre: 'Yerba Mate', categoria: 'Almacén', proveedor: 'Las Marías', unidad: 'UNIDAD', stockActual: 75, stockCritico: 40, precioVenta: 3900, costo: 2700 },
  { nombre: 'Huevos Maple', categoria: 'Granja', proveedor: 'Granja del Sol', unidad: 'UNIDAD', stockActual: 6, stockCritico: 30, precioVenta: 5400, costo: 3900 },
];

const CLIENTES: Cliente[] = [
  { nombre: 'Kiosco Gral Paz', tipo: 'EMPRESA', saldo: 184500 },
  { nombre: 'Almacén Natural', tipo: 'EMPRESA', saldo: 92300 },
  { nombre: 'Rotisería El Buen Sabor', tipo: 'EMPRESA', saldo: 0 },
  { nombre: 'Consumidor Final', tipo: 'CF', saldo: 0 },
  { nombre: 'Panadería La Esquina', tipo: 'EMPRESA', saldo: 47800 },
  { nombre: 'Juan Pérez', tipo: 'PERSONA_FISICA', saldo: 0 },
];

const PROVEEDORES: Proveedor[] = [
  { nombre: 'Dicaro', deuda: 320000, totalComprado: 1250000, ordenes: 8, ultimaOrdenFecha: '2026-10-02' },
  { nombre: 'La Serenísima', deuda: 145000, totalComprado: 680000, ordenes: 5, ultimaOrdenFecha: '2026-09-28' },
  { nombre: 'Molinos', deuda: 0, totalComprado: 410000, ordenes: 6, ultimaOrdenFecha: '2026-10-04' },
  { nombre: 'Las Marías', deuda: 88000, totalComprado: 230000, ordenes: 3, ultimaOrdenFecha: '2026-09-20' },
  { nombre: 'Granja del Sol', deuda: 52000, totalComprado: 160000, ordenes: 4, ultimaOrdenFecha: '2026-10-05' },
];

// Ventas repartidas sobre septiembre–octubre 2026 (hoy del demo: 2026-10-07).
const VENTAS: Venta[] = [
  { numero: 101, fecha: '2026-09-15', clienteNombre: 'Kiosco Gral Paz', tipoCliente: 'EMPRESA', formaPago: 'CUENTA_CORRIENTE', items: [{ producto: 'Muzzarella', cantidad: 12, precioUnitario: 6200 }, { producto: 'Queso Cremoso', cantidad: 8, precioUnitario: 5800 }] },
  { numero: 102, fecha: '2026-09-22', clienteNombre: 'Almacén Natural', tipoCliente: 'EMPRESA', formaPago: 'CUENTA_CORRIENTE', items: [{ producto: 'Harina 000', cantidad: 50, precioUnitario: 980 }, { producto: 'Aceite Girasol', cantidad: 20, precioUnitario: 2600 }] },
  { numero: 103, fecha: '2026-09-29', clienteNombre: 'Consumidor Final', tipoCliente: 'CF', formaPago: 'CONTADO', items: [{ producto: 'Dulce de Leche', cantidad: 3, precioUnitario: 4200 }, { producto: 'Yerba Mate', cantidad: 4, precioUnitario: 3900 }] },
  { numero: 104, fecha: '2026-10-01', clienteNombre: 'Panadería La Esquina', tipoCliente: 'EMPRESA', formaPago: 'CUENTA_CORRIENTE', items: [{ producto: 'Harina 000', cantidad: 80, precioUnitario: 980 }, { producto: 'Manteca', cantidad: 15, precioUnitario: 7100 }] },
  { numero: 105, fecha: '2026-10-02', clienteNombre: 'Kiosco Gral Paz', tipoCliente: 'EMPRESA', formaPago: 'CUENTA_CORRIENTE', items: [{ producto: 'Muzzarella', cantidad: 18, precioUnitario: 6200 }, { producto: 'Huevos Maple', cantidad: 10, precioUnitario: 5400 }] },
  { numero: 106, fecha: '2026-10-03', clienteNombre: 'Consumidor Final', tipoCliente: 'CF', formaPago: 'CONTADO', items: [{ producto: 'Yerba Mate', cantidad: 6, precioUnitario: 3900 }] },
  { numero: 107, fecha: '2026-10-05', clienteNombre: 'Rotisería El Buen Sabor', tipoCliente: 'EMPRESA', formaPago: 'CONTADO', items: [{ producto: 'Muzzarella', cantidad: 25, precioUnitario: 6200 }, { producto: 'Queso Cremoso', cantidad: 10, precioUnitario: 5800 }] },
  { numero: 108, fecha: '2026-10-06', clienteNombre: 'Almacén Natural', tipoCliente: 'EMPRESA', formaPago: 'CUENTA_CORRIENTE', items: [{ producto: 'Dulce de Leche', cantidad: 5, precioUnitario: 4200 }, { producto: 'Manteca', cantidad: 6, precioUnitario: 7100 }] },
];

const LISTAS_PRECIO = [
  { nombre: 'Mayorista', productos: 8, clientes: 4 },
  { nombre: 'Minorista', productos: 8, clientes: 2 },
  { nombre: 'Promo Lácteos', productos: 4, clientes: 1 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOY = '2026-10-07';

function totalVenta(v: Venta): number {
  return v.items.reduce((acc, it) => acc + it.cantidad * it.precioUnitario, 0);
}

function enRango(fecha: string, desde?: string | null, hasta?: string | null): boolean {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function matchTexto(valor: string, filtro?: string | null): boolean {
  if (!filtro) return true;
  return valor.toLowerCase().includes(filtro.toLowerCase());
}

type Args = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tool implementations (mock) — misma firma y contrato que las tools reales
// ---------------------------------------------------------------------------

function consultarVentas(args: Args): ResultadoPresentable {
  const { desde, hasta, producto, categoria, proveedor, tipoCliente, formaPago, cliente, modo } =
    args as Record<string, string | null>;

  const ventasRango = VENTAS.filter((v) => enRango(v.fecha, desde, hasta))
    .filter((v) => (tipoCliente ? v.tipoCliente === tipoCliente : true))
    .filter((v) => (formaPago ? v.formaPago === formaPago : true))
    .filter((v) => matchTexto(v.clienteNombre, cliente));

  const prod = (it: ItemVenta) => PRODUCTOS.find((p) => p.nombre === it.producto)!;
  const itemsFiltrados = (v: Venta) =>
    v.items.filter(
      (it) =>
        matchTexto(it.producto, producto) &&
        matchTexto(prod(it).categoria, categoria) &&
        matchTexto(prod(it).proveedor, proveedor),
    );

  if (modo === 'rankingProductos') {
    const acum = new Map<string, { cantidad: number; importe: number }>();
    for (const v of ventasRango) {
      for (const it of itemsFiltrados(v)) {
        const cur = acum.get(it.producto) ?? { cantidad: 0, importe: 0 };
        cur.cantidad += it.cantidad;
        cur.importe += it.cantidad * it.precioUnitario;
        acum.set(it.producto, cur);
      }
    }
    const ranking = [...acum.entries()]
      .map(([nombre, x]) => ({ productoNombre: nombre, cantidadVendida: x.cantidad, importeTotal: x.importe }))
      .sort((a, b) => b.importeTotal - a.importeTotal);
    return {
      resumen: ranking.length ? `Producto más vendido por importe: ${ranking[0].productoNombre}.` : 'Sin ventas en el período.',
      ranking,
      metricas: metricas(metrica('top', 'Producto top', ranking[0]?.productoNombre ?? null, 'text')),
      columnas: [col.text('productoNombre', 'Producto'), col.number('cantidadVendida', 'Cantidad'), col.currency('importeTotal', 'Importe')],
      filas: ranking as unknown as Fila[],
      metadata: metadata(ranking.length, ranking.length),
    } as ResultadoPresentable & { ranking: unknown };
  }

  if (modo === 'comparativa') {
    const contado = ventasRango.filter((v) => v.formaPago === 'CONTADO').reduce((a, v) => a + totalVenta(v), 0);
    const cuentaCorriente = ventasRango.filter((v) => v.formaPago === 'CUENTA_CORRIENTE').reduce((a, v) => a + totalVenta(v), 0);
    const total = contado + cuentaCorriente || 1;
    return {
      resumen: `Contado ${((contado / total) * 100).toFixed(1)}% vs. cuenta corriente ${((cuentaCorriente / total) * 100).toFixed(1)}%.`,
      contado,
      cuentaCorriente,
      metricas: metricas(
        metrica('contado', 'Contado', contado, 'currency'),
        metrica('cuentaCorriente', 'Cuenta corriente', cuentaCorriente, 'currency'),
        metrica('pctContado', '% Contado', Number(((contado / total) * 100).toFixed(1)), 'percent'),
      ),
      columnas: [],
      filas: [],
      metadata: metadata(ventasRango.length, ventasRango.length),
    } as ResultadoPresentable & { contado: number };
  }

  // modo 'resumen' (default)
  let importeTotal = 0;
  let cantidadKg = 0;
  let cantidadUnidades = 0;
  let lineas = 0;
  for (const v of ventasRango) {
    for (const it of itemsFiltrados(v)) {
      lineas += 1;
      const subtotal = it.cantidad * it.precioUnitario;
      importeTotal += subtotal;
      if (prod(it).unidad === 'KG') cantidadKg += it.cantidad;
      else cantidadUnidades += it.cantidad;
    }
  }
  const ventasConItems = ventasRango.filter((v) => itemsFiltrados(v).length > 0).length;
  const ticketPromedio = ventasConItems ? Math.round(importeTotal / ventasConItems) : null;
  return {
    resumen: `Se facturaron ${importeTotal} en ${ventasConItems} ventas.`,
    importeTotal,
    cantidadKg,
    cantidadUnidades,
    lineas,
    ventas: ventasConItems,
    ticketPromedio: ticketPromedio ?? undefined,
    metricas: metricas(
      metrica('importeTotal', 'Facturación', importeTotal, 'currency'),
      metrica('ventas', 'Ventas', ventasConItems, 'number'),
      metrica('cantidadKg', 'Kilos', cantidadKg || null, 'kg'),
      metrica('cantidadUnidades', 'Unidades', cantidadUnidades || null, 'un'),
      metrica('ticketPromedio', 'Ticket promedio', ticketPromedio, 'currency'),
    ),
    columnas: [],
    filas: [],
    metadata: metadata(ventasConItems, ventasConItems),
  } as ResultadoPresentable & { importeTotal: number };
}

function consultarCompras(args: Args): ResultadoPresentable {
  const { proveedor, categoria } = args as Record<string, string | null>;
  const provs = PROVEEDORES.filter((p) => matchTexto(p.nombre, proveedor));
  const totalComprado = provs.reduce((a, p) => a + p.totalComprado, 0);
  const ordenes = provs.reduce((a, p) => a + p.ordenes, 0);
  return {
    resumen: `Se compraron ${totalComprado} en ${ordenes} órdenes${categoria ? ` de ${categoria}` : ''}.`,
    totalComprado,
    ordenes,
    metricas: metricas(
      metrica('totalComprado', 'Total comprado', totalComprado, 'currency'),
      metrica('ordenes', 'Órdenes', ordenes, 'number'),
    ),
    columnas: [col.text('nombre', 'Proveedor'), col.currency('totalComprado', 'Comprado'), col.number('ordenes', 'Órdenes')],
    filas: provs.map((p) => ({ nombre: p.nombre, totalComprado: p.totalComprado, ordenes: p.ordenes })),
    metadata: metadata(provs.length, provs.length),
  } as ResultadoPresentable & { totalComprado: number };
}

function consultarStock(args: Args): ResultadoPresentable {
  const { producto, categoria, proveedor, modo } = args as Record<string, string | null>;
  const filtrados = PRODUCTOS.filter(
    (p) => matchTexto(p.nombre, producto) && matchTexto(p.categoria, categoria) && matchTexto(p.proveedor, proveedor),
  );

  if (modo === 'categorias') {
    const porCat = new Map<string, number>();
    for (const p of PRODUCTOS) porCat.set(p.categoria, (porCat.get(p.categoria) ?? 0) + 1);
    const filas = [...porCat.entries()].map(([categoriaNombre, cantidadProductos]) => ({ categoriaNombre, cantidadProductos }));
    return {
      resumen: `${porCat.size} categorías en el catálogo.`,
      metricas: metricas(metrica('categorias', 'Categorías', porCat.size, 'number')),
      columnas: [col.text('categoriaNombre', 'Categoría'), col.number('cantidadProductos', 'Productos')],
      filas: filas as unknown as Fila[],
      metadata: metadata(filas.length, filas.length),
    };
  }

  if (modo === 'porEstado') {
    const total = PRODUCTOS.length;
    const criticos = PRODUCTOS.filter((p) => p.stockActual < p.stockCritico).length;
    const normales = total - criticos;
    return {
      resumen: `${criticos} de ${total} productos en estado crítico.`,
      totalProductos: total,
      normales,
      criticos,
      metricas: metricas(
        metrica('criticos', 'Críticos', criticos, 'number'),
        metrica('normales', 'Normales', normales, 'number'),
        metrica('pctCritico', '% Crítico', Number(((criticos / total) * 100).toFixed(1)), 'percent'),
      ),
      columnas: [],
      filas: [],
      metadata: metadata(total, total),
    } as ResultadoPresentable & { criticos: number };
  }

  // modo 'resumen' (default)
  const bajoCritico = filtrados.filter((p) => p.stockActual < p.stockCritico);
  return {
    resumen: `${bajoCritico.length} producto(s) por debajo del stock crítico.`,
    cantidadBajoStockCritico: bajoCritico.length,
    metricas: metricas(
      metrica('productos', 'Productos', filtrados.length, 'number'),
      metrica('bajoCritico', 'Bajo crítico', bajoCritico.length, 'number'),
    ),
    columnas: [
      col.text('nombre', 'Producto'),
      col.number('stockActual', 'Stock'),
      col.number('stockCritico', 'Crítico'),
      col.status('estado', 'Estado'),
    ],
    filas: filtrados.map((p) => ({
      nombre: p.nombre,
      stockActual: p.stockActual,
      stockCritico: p.stockCritico,
      estado: p.stockActual < p.stockCritico ? 'CRÍTICO' : 'OK',
    })),
    metadata: metadata(filtrados.length, filtrados.length),
  } as ResultadoPresentable & { cantidadBajoStockCritico: number };
}

function consultarMargen(args: Args): ResultadoPresentable {
  const { desde, hasta, producto, categoria, proveedor } = args as Record<string, string | null>;
  const prod = (it: ItemVenta) => PRODUCTOS.find((p) => p.nombre === it.producto)!;
  let ingreso = 0;
  let costo = 0;
  for (const v of VENTAS.filter((v) => enRango(v.fecha, desde, hasta))) {
    for (const it of v.items) {
      const p = prod(it);
      if (!matchTexto(it.producto, producto) || !matchTexto(p.categoria, categoria) || !matchTexto(p.proveedor, proveedor)) continue;
      ingreso += it.cantidad * it.precioUnitario;
      costo += it.cantidad * p.costo;
    }
  }
  const margen = ingreso - costo;
  const pct = ingreso ? Number(((margen / ingreso) * 100).toFixed(1)) : null;
  return {
    resumen: `Margen bruto de ${margen} (${pct ?? 0}%).`,
    ingreso,
    costo,
    margen,
    metricas: metricas(
      metrica('ingreso', 'Ingreso', ingreso, 'currency'),
      metrica('costo', 'Costo', costo, 'currency'),
      metrica('margen', 'Margen bruto', margen, 'currency'),
      metrica('pct', '% Margen', pct, 'percent'),
    ),
    columnas: [],
    filas: [],
    metadata: metadata(1, 1),
  } as ResultadoPresentable & { margen: number };
}

function consultarClientes(args: Args): ResultadoPresentable {
  const { desde, hasta } = args as Record<string, string | null>;
  const conDeuda = CLIENTES.filter((c) => c.saldo > 0);
  const deudaTotal = conDeuda.reduce((a, c) => a + c.saldo, 0);
  const ventasRango = VENTAS.filter((v) => enRango(v.fecha, desde, hasta));
  const contado = ventasRango.filter((v) => v.formaPago === 'CONTADO').reduce((a, v) => a + totalVenta(v), 0);
  const cuentaCorriente = ventasRango.filter((v) => v.formaPago === 'CUENTA_CORRIENTE').reduce((a, v) => a + totalVenta(v), 0);
  return {
    resumen: `${conDeuda.length} clientes con deuda, total ${deudaTotal}.`,
    deudaTotal,
    clientesConDeuda: conDeuda.length,
    metricas: metricas(
      metrica('deudaTotal', 'Deuda total', deudaTotal, 'currency'),
      metrica('clientesConDeuda', 'Clientes con deuda', conDeuda.length, 'number'),
      metrica('contado', 'Ventas contado', contado || null, 'currency'),
      metrica('cuentaCorriente', 'Ventas cta. cte.', cuentaCorriente || null, 'currency'),
    ),
    columnas: [col.text('nombre', 'Cliente'), col.currency('saldo', 'Deuda')],
    filas: conDeuda.map((c) => ({ nombre: c.nombre, saldo: c.saldo })),
    metadata: metadata(conDeuda.length, conDeuda.length),
  } as ResultadoPresentable & { deudaTotal: number };
}

function obtenerEstadoCuentaCliente(args: Args): ResultadoPresentable {
  const { cliente } = args as Record<string, string | null>;
  const candidatos = CLIENTES.filter((c) => matchTexto(c.nombre, cliente));
  if (candidatos.length === 0) {
    return {
      clienteNoEncontrado: true,
      resumen: `No se encontró el cliente "${cliente}".`,
      metricas: [],
      columnas: [],
      filas: [],
      metadata: metadata(0, 0),
    } as ResultadoPresentable & { clienteNoEncontrado: boolean };
  }
  const c = candidatos[0];
  const ventasCliente = VENTAS.filter((v) => v.clienteNombre === c.nombre);
  return {
    resumen: `${c.nombre} tiene un saldo pendiente de ${c.saldo}.`,
    nombre: c.nombre,
    saldo: c.saldo,
    metricas: metricas(
      metrica('saldo', 'Saldo pendiente', c.saldo, 'currency'),
      metrica('ventas', 'Ventas registradas', ventasCliente.length, 'number'),
    ),
    columnas: [col.number('numero', 'Venta'), col.date('fecha', 'Fecha'), col.currency('total', 'Total'), col.status('formaPago', 'Forma de pago')],
    filas: ventasCliente.map((v) => ({ numero: v.numero, fecha: v.fecha, total: totalVenta(v), formaPago: v.formaPago })),
    metadata: metadata(ventasCliente.length, ventasCliente.length),
  } as ResultadoPresentable & { saldo: number };
}

function resumenProveedor(args: Args): ResultadoPresentable {
  const { proveedor } = args as Record<string, string | null>;
  const provs = PROVEEDORES.filter((p) => matchTexto(p.nombre, proveedor));
  if (proveedor && provs.length === 1) {
    const p = provs[0];
    return {
      resumen: `Al proveedor ${p.nombre} se le debe ${p.deuda}.`,
      nombre: p.nombre,
      deuda: p.deuda,
      metricas: metricas(
        metrica('deuda', 'Deuda actual', p.deuda, 'currency'),
        metrica('totalComprado', 'Total comprado', p.totalComprado, 'currency'),
        metrica('ordenes', 'Órdenes', p.ordenes, 'number'),
      ),
      columnas: [],
      filas: [],
      metadata: metadata(1, 1),
    } as ResultadoPresentable & { deuda: number };
  }
  const deudaTotal = provs.reduce((a, p) => a + p.deuda, 0);
  return {
    resumen: `${provs.length} proveedores, deuda total ${deudaTotal}.`,
    deudaTotal,
    metricas: metricas(metrica('deudaTotal', 'Deuda total', deudaTotal, 'currency')),
    columnas: [col.text('nombre', 'Proveedor'), col.currency('deuda', 'Deuda'), col.currency('totalComprado', 'Comprado')],
    filas: provs.map((p) => ({ nombre: p.nombre, deuda: p.deuda, totalComprado: p.totalComprado })),
    metadata: metadata(provs.length, provs.length),
  } as ResultadoPresentable & { deudaTotal: number };
}

function reposicionStock(args: Args): ResultadoPresentable {
  const { proveedor, categoria, producto, diasCubrir } = args as Record<string, string | null>;
  const dias = Number(diasCubrir) || 15;
  const filtrados = PRODUCTOS.filter(
    (p) => matchTexto(p.nombre, producto) && matchTexto(p.categoria, categoria) && matchTexto(p.proveedor, proveedor),
  );
  // Consumo diario aproximado = ventas del producto en los últimos ~30 días / 30.
  const consumoDiario = (nombre: string) => {
    const vendido = VENTAS.filter((v) => enRango(v.fecha, '2026-09-07', HOY))
      .flatMap((v) => v.items)
      .filter((it) => it.producto === nombre)
      .reduce((a, it) => a + it.cantidad, 0);
    return vendido / 30;
  };
  const urgentes = filtrados
    .map((p) => {
      const cd = consumoDiario(p.nombre);
      const coberturaDias = cd > 0 ? Math.round(p.stockActual / cd) : 999;
      const aComprar = Math.max(0, Math.round(cd * dias - p.stockActual));
      return { producto: p.nombre, stockActual: p.stockActual, coberturaDias, aComprar, urgente: coberturaDias < dias };
    })
    .filter((x) => x.urgente)
    .sort((a, b) => a.coberturaDias - b.coberturaDias);
  return {
    resumen: urgentes.length ? `${urgentes.length} producto(s) urgentes para reponer (cobertura < ${dias} días).` : 'No hay productos urgentes para reponer.',
    diasCubrir: dias,
    metricas: metricas(metrica('urgentes', 'Urgentes', urgentes.length, 'number')),
    columnas: [col.text('producto', 'Producto'), col.number('stockActual', 'Stock'), col.number('coberturaDias', 'Cobertura (días)'), col.number('aComprar', 'A comprar')],
    filas: urgentes as unknown as Fila[],
    metadata: metadata(urgentes.length, urgentes.length),
  } as ResultadoPresentable & { diasCubrir: number };
}

function consultarCaja(args: Args): ResultadoPresentable {
  const { desde, hasta, modo } = args as Record<string, string | null>;
  if (modo === 'sesionActual') {
    return {
      resumen: 'Hay una caja abierta desde las 08:30 con un monto inicial de 20000.',
      hayAbierta: true,
      montoInicial: 20000,
      horaApertura: '08:30',
      metricas: metricas(metrica('montoInicial', 'Monto inicial', 20000, 'currency')),
      columnas: [],
      filas: [],
      metadata: metadata(1, 1),
    } as ResultadoPresentable & { hayAbierta: boolean };
  }
  const ventasRango = VENTAS.filter((v) => enRango(v.fecha, desde, hasta) && v.formaPago === 'CONTADO');
  const efectivo = Math.round(ventasRango.reduce((a, v) => a + totalVenta(v), 0) * 0.7);
  const transferencia = Math.round(ventasRango.reduce((a, v) => a + totalVenta(v), 0) * 0.2);
  const tarjeta = ventasRango.reduce((a, v) => a + totalVenta(v), 0) - efectivo - transferencia;
  const ingresos = efectivo + transferencia + tarjeta;
  return {
    resumen: `Ingresos de caja por ${ingresos} en el período.`,
    ingresos,
    metricas: metricas(
      metrica('ingresos', 'Ingresos', ingresos, 'currency'),
      metrica('efectivo', 'Efectivo', efectivo, 'currency'),
      metrica('transferencia', 'Transferencia', transferencia, 'currency'),
      metrica('tarjeta', 'Tarjeta', tarjeta, 'currency'),
    ),
    columnas: [],
    filas: [],
    metadata: metadata(ventasRango.length, ventasRango.length),
  } as ResultadoPresentable & { ingresos: number };
}

function consultarTesoreria(args: Args): ResultadoPresentable {
  const { desde, hasta } = args as Record<string, string | null>;
  const ventasRango = VENTAS.filter((v) => enRango(v.fecha, desde, hasta));
  const ingresos = ventasRango.reduce((a, v) => a + totalVenta(v), 0);
  const egresos = Math.round(ingresos * 0.55);
  const efectivo = Math.round(ingresos * 0.4);
  const bancos = ingresos - efectivo;
  return {
    resumen: `Ingresos ${ingresos}, egresos ${egresos}, neto ${ingresos - egresos}.`,
    ingresos,
    egresos,
    neto: ingresos - egresos,
    metricas: metricas(
      metrica('ingresos', 'Ingresos', ingresos, 'currency'),
      metrica('egresos', 'Egresos', egresos, 'currency'),
      metrica('efectivo', 'Efectivo', efectivo, 'currency'),
      metrica('bancos', 'Bancos', bancos, 'currency'),
    ),
    columnas: [],
    filas: [],
    metadata: metadata(ventasRango.length, ventasRango.length),
  } as ResultadoPresentable & { ingresos: number };
}

function consultarListasPrecio(args: Args): ResultadoPresentable {
  const { modo, producto } = args as Record<string, string | null>;
  if (modo === 'producto' && producto) {
    const p = PRODUCTOS.find((x) => matchTexto(x.nombre, producto));
    const filas = LISTAS_PRECIO.map((l, i) => ({
      lista: l.nombre,
      precio: p ? Math.round(p.precioVenta * (1 - i * 0.05)) : 0,
    }));
    return {
      resumen: p ? `Precio de ${p.nombre} por lista.` : `No se encontró el producto "${producto}".`,
      metricas: [],
      columnas: [col.text('lista', 'Lista'), col.currency('precio', 'Precio')],
      filas: filas as unknown as Fila[],
      metadata: metadata(filas.length, filas.length),
    };
  }
  return {
    resumen: `${LISTAS_PRECIO.length} listas de precio activas.`,
    metricas: metricas(metrica('listas', 'Listas', LISTAS_PRECIO.length, 'number')),
    columnas: [col.text('nombre', 'Lista'), col.number('productos', 'Productos'), col.number('clientes', 'Clientes')],
    filas: LISTAS_PRECIO as unknown as Fila[],
    metadata: metadata(LISTAS_PRECIO.length, LISTAS_PRECIO.length),
  };
}

// ---------------------------------------------------------------------------
// Router — misma allowlist que `src/ia/tools/tool-router.service.ts`
// ---------------------------------------------------------------------------

export interface ToolRouter {
  ejecutar(nombre: string, args: unknown): Promise<unknown>;
}

const HANDLERS: Record<string, (args: Args) => ResultadoPresentable> = {
  consultarVentas,
  consultarCompras,
  consultarStock,
  consultarMargen,
  consultarClientes,
  obtenerEstadoCuentaCliente,
  resumenProveedor,
  reposicionStock,
  consultarCaja,
  consultarTesoreria,
  consultarListasPrecio,
};

export class MockToolRouter implements ToolRouter {
  async ejecutar(nombre: string, args: unknown): Promise<unknown> {
    const handler = HANDLERS[nombre];
    if (!handler) {
      // Mismo criterio que el router real: lo que no está en la allowlist no existe.
      throw new Error(`Tool no permitida: ${nombre}`);
    }
    return handler((args ?? {}) as Args);
  }
}
