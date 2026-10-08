import { Module } from '@nestjs/common';
import { ReportesModule } from '../reportes/reportes.module';
import { GroqService } from './groq/groq.service';
import { IaController } from './ia.controller';
import { IaService } from './ia.service';
import { IaQuotaService } from './quota/ia-quota.service';
import { CajaToolService } from './tools/caja.tool';
import { ClientesToolService } from './tools/clientes.tool';
import { ComprasToolService } from './tools/compras.tool';
import { EstadoCuentaClienteToolService } from './tools/estado-cuenta-cliente.tool';
import { ListasPrecioToolService } from './tools/listas-precio.tool';
import { MargenToolService } from './tools/margen.tool';
import { ReposicionStockToolService } from './tools/reposicion-stock.tool';
import { ResumenProveedorToolService } from './tools/resumen-proveedor.tool';
import { StockToolService } from './tools/stock.tool';
import { TesoreriaToolService } from './tools/tesoreria.tool';
import { ToolRouterService } from './tools/tool-router.service';
import { VentasToolService } from './tools/ventas.tool';
import { IaUsageService } from './usage/ia-usage.service';

/**
 * Consultas en lenguaje natural sobre el ERP vía Groq (spec `compartido/17`). Las TOOLS siguen
 * siendo 100% lectura cross-módulo; el módulo en sí, desde la spec `compartido/20`, sí persiste
 * metadata de uso propia (`ConsumoIa`, cuotas de `IaQuotaService`) — ya no es "sin escrituras
 * propias". `PrismaService`/`ConfigService` son `@Global()`, no requiere `imports` extra para
 * eso. `ReportesModule` sí se importa explícitamente (Fase 1c): la tool `reposicionStock` reusa
 * `ReportesStockService.reposicion()` en vez de duplicarlo. Nunca se importa `CajaModule` acá —
 * arrastra la cadena circular `CajaModule` ↔ `VentasModule` ↔ `ComprasModule` (`forwardRef` en
 * los tres); `consultarCaja` replica esa lógica con Prisma directo en su lugar.
 */
@Module({
  imports: [ReportesModule],
  controllers: [IaController],
  providers: [
    IaService,
    GroqService,
    IaQuotaService,
    IaUsageService,
    ToolRouterService,
    VentasToolService,
    ComprasToolService,
    StockToolService,
    ReposicionStockToolService,
    ClientesToolService,
    EstadoCuentaClienteToolService,
    ResumenProveedorToolService,
    MargenToolService,
    CajaToolService,
    TesoreriaToolService,
    ListasPrecioToolService,
  ],
})
export class IaModule {}
