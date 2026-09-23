import 'reflect-metadata';
import { readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import cookieParser = require('cookie-parser');
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';

async function bootstrap() {
  // Sem HTTPS o navegador não guarda o app no aparelho (service worker exige
  // origem segura) e o PDV perde o modo offline. `npm run cert` gera o par.
  const httpsOptions = process.env.SSL_KEY && process.env.SSL_CERT
    ? { key: readFileSync(process.env.SSL_KEY), cert: readFileSync(process.env.SSL_CERT) }
    : undefined;

  const app = await NestFactory.create(AppModule, { bodyParser: true, httpsOptions });
  // atrás do nginx: req.ip vem do X-Forwarded-For (throttle e auditoria por cliente, não por proxy)
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  app.use(cookieParser());
  // planilha de importação chega como texto no corpo
  const express = require('express');
  app.use(express.json({ limit: '5mb' }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    // request id para casar log de erro com o que o usuário viu
    const id = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('X-Request-Id', id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // app do vendedor externo roda em outra origem. Só /api/ext: lá a sessão é
    // token Bearer (sem cookie), então liberar qualquer origem não abre CSRF.
    if (req.path.startsWith('/api/ext/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') return void res.status(204).end();
    }
    next();
  });

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  const log = new Logger('LojaFlow');
  log.log(`${httpsOptions ? 'https' : 'http'}://localhost:${port}`);
  if (!httpsOptions) log.warn('Sem HTTPS: o PDV offline não funciona fora de localhost. Veja "npm run cert".');
}

bootstrap();
