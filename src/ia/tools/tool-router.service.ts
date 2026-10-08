import { BadRequestException, Injectable } from '@nestjs/common';
import { CajaToolService } from './caja.tool';
import { ClientesToolService } from './clientes.tool';
import { ComprasToolService } from './compras.tool';
import { EstadoCuentaClienteToolService } from './estado-cuenta-cliente.tool';
import { ListasPrecioToolService } from './listas-precio.tool';
import { MargenToolService } from './margen.tool';
import { ReposicionStockToolService } from './reposicion-stock.tool';
import { ResumenProveedorToolService } from './resumen-proveedor.tool';
import { StockToolService } from './stock.tool';
import { TesoreriaToolService } from './tesoreria.tool';
import { VentasToolService } from './ventas.tool';

/**
 * Allowlist explícita (spec `compartido/17`, "límites duros"). Lo que no está en este
 * `switch` no existe para el modelo, sin importar qué le pida a `groq-tools`.
 */
@Injectable()
export class ToolRouterService {
  constructor(
    private readonly ventas: VentasToolService,
    private readonly compras: ComprasToolService,
    private readonly stock: StockToolService,
    private readonly reposicionStock: ReposicionStockToolService,
    private readonly clientes: ClientesToolService,
    private readonly estadoCuentaCliente: EstadoCuentaClienteToolService,
    private readonly resumenProveedor: ResumenProveedorToolService,
    private readonly margen: MargenToolService,
    private readonly caja: CajaToolService,
    private readonly tesoreria: TesoreriaToolService,
    private readonly listasPrecio: ListasPrecioToolService,
  ) {}

  async ejecutar(nombre: string, args: unknown): Promise<unknown> {
    switch (nombre) {
      case 'consultarVentas':
        return this.ventas.ejecutar(
          args as Parameters<typeof this.ventas.ejecutar>[0],
        );
      case 'consultarCompras':
        return this.compras.ejecutar(
          args as Parameters<typeof this.compras.ejecutar>[0],
        );
      case 'consultarStock':
        return this.stock.ejecutar(
          args as Parameters<typeof this.stock.ejecutar>[0],
        );
      case 'reposicionStock':
        return this.reposicionStock.ejecutar(
          args as Parameters<typeof this.reposicionStock.ejecutar>[0],
        );
      case 'consultarClientes':
        return this.clientes.ejecutar(
          args as Parameters<typeof this.clientes.ejecutar>[0],
        );
      case 'obtenerEstadoCuentaCliente':
        return this.estadoCuentaCliente.ejecutar(
          args as Parameters<typeof this.estadoCuentaCliente.ejecutar>[0],
        );
      case 'resumenProveedor':
        return this.resumenProveedor.ejecutar(
          args as Parameters<typeof this.resumenProveedor.ejecutar>[0],
        );
      case 'consultarMargen':
        return this.margen.ejecutar(
          args as Parameters<typeof this.margen.ejecutar>[0],
        );
      case 'consultarCaja':
        return this.caja.ejecutar(
          args as Parameters<typeof this.caja.ejecutar>[0],
        );
      case 'consultarTesoreria':
        return this.tesoreria.ejecutar(
          args as Parameters<typeof this.tesoreria.ejecutar>[0],
        );
      case 'consultarListasPrecio':
        return this.listasPrecio.ejecutar(
          args as Parameters<typeof this.listasPrecio.ejecutar>[0],
        );
      default:
        throw new BadRequestException(`Tool no permitida: ${nombre}`);
    }
  }
}
