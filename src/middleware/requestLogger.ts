import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

/**
 * HTTP request and response logger middleware.
 * Logs incoming request metadata (IP, query, body) and outgoing response status, latency, and JSON body.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const url = req.originalUrl;

  // Skip static Swagger UI asset requests (.css, .js, .png, etc.)
  if (url.startsWith('/api/docs') && url !== '/api/docs' && url !== '/api/docs/') {
    next();
    return;
  }

  const isDocsPage = url === '/api/docs' || url === '/api/docs/';
  const startTime = Date.now();
  const ip = req.ip || req.socket.remoteAddress;

  logger.info(
    {
      ip,
      query: Object.keys(req.query || {}).length ? req.query : undefined,
      body: !isDocsPage && req.body && Object.keys(req.body).length ? req.body : undefined,
    },
    `📥 [API REQ] ${req.method} ${url}`
  );

  if (!isDocsPage) {
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      res.locals.responseBody = body;
      return originalJson(body);
    }) as Response['json'];

    const originalSend = res.send.bind(res);
    res.send = ((body: unknown) => {
      if (res.locals.responseBody === undefined && typeof body === 'string') {
        try {
          res.locals.responseBody = JSON.parse(body);
        } catch {
          // Non-JSON response body (e.g. HTML/plain text) is intentionally omitted
        }
      }
      return originalSend(body);
    }) as Response['send'];
  }

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const message = `📤 [API RES] ${req.method} ${url} -> ${res.statusCode} (${durationMs}ms)`;
    const meta = {
      statusCode: res.statusCode,
      durationMs: `${durationMs}ms`,
      response: isDocsPage ? undefined : res.locals.responseBody,
    };

    if (res.statusCode >= 500) {
      logger.error(meta, message);
    } else if (res.statusCode >= 400) {
      logger.warn(meta, message);
    } else {
      logger.info(meta, message);
    }
  });

  next();
}
