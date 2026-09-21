import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { existsSync } from 'fs';
import { PrismaModule } from './common/prisma.service';
import { CoreModule } from './common/core';
import { AuthGuard } from './common/auth.guard';
import { HttpErrorFilter } from './common/error.filter';
import { AuthModule } from './modules/auth';
import { CatalogModule } from './modules/catalog';
import { CrmModule } from './modules/crm';
import { StockModule } from './modules/stock';
import { SalesModule } from './modules/sales';
import { CashModule } from './modules/cash';
import { FinanceModule } from './modules/finance';
import { ReportsModule } from './modules/reports';
import { CompanyModule } from './modules/company';
import { UsersModule } from './modules/users';
import { BillingModule } from './modules/billing';
import { ImportsModule } from './modules/imports';
import { PaymentsModule } from './modules/payments';
import { FiscalModule } from './modules/fiscal';
import { MiscModule } from './modules/misc';

// O tema Riho fica na pasta do starter kit; se copiado para dentro do projeto, usa a cópia local.
const localAssets = join(__dirname, '..', 'public', 'assets');
const themeAssets = existsSync(localAssets) ? localAssets : join(__dirname, '..', '..', 'assets');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CoreModule,
    // PDV dispara muitas leituras por minuto (busca por código): teto generoso por IP.
    // THROTTLE_LIMIT ajusta por ambiente (atrás de proxy, todos os caixas somam no mesmo IP).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: Number(process.env.THROTTLE_LIMIT) || 600 }]),
    ServeStaticModule.forRoot(
      { rootPath: themeAssets, serveRoot: '/assets' },
      { rootPath: join(__dirname, '..', 'public'), exclude: ['/api/{*path}'] },
    ),
    AuthModule, CatalogModule, CrmModule, StockModule, SalesModule, CashModule,
    FinanceModule, ReportsModule, CompanyModule, UsersModule, BillingModule, ImportsModule, PaymentsModule, FiscalModule, MiscModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    },
  ],
})
export class AppModule {}
