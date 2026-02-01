import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as compression from 'compression';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Security
  app.use(helmet());
  app.use(compression());

  // Capture raw body for webhook signature verification
  app.use(
    bodyParser.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(bodyParser.urlencoded({ extended: false }));

  // CORS
  app.enableCors({
    origin: configService.get('CORS_ORIGIN', '*'),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'Idempotency-Key',
      'X-Webhook-Event',
      'X-Webhook-Timestamp',
      'X-Webhook-Signature',
    ],
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix(configService.get('API_PREFIX', 'v1'));

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Start server
  const port = configService.get('PORT', 3000);
  await app.listen(port);

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                  WhapVibez Backend API                    ║
╠═══════════════════════════════════════════════════════════╣
║  🚀 Server running on: http://localhost:${port}              ║
║  📚 API Prefix: /${configService.get('API_PREFIX', 'v1')}                                     ║
║  🌍 Environment: ${configService.get('NODE_ENV', 'development')}                        ║
╚═══════════════════════════════════════════════════════════╝
  `);
}

bootstrap();

