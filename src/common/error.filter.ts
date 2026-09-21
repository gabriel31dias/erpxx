import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Resposta de erro previsível para o front, sem vazar stack trace nem SQL. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      const message = Array.isArray(body?.message) ? body.message[0] : body?.message ?? exception.message;
      return res.status(status).json({ statusCode: status, message });
    }

    this.logger.error(`${req.method} ${req.url}`, exception instanceof Error ? exception.stack : String(exception));
    return res.status(500).json({
      statusCode: 500,
      message: 'Não foi possível concluir a operação. Tente novamente.',
    });
  }
}
