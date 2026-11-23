import fs from 'node:fs';
import path from 'node:path';
import { createGameServer } from './server';

// Settings can also be kept in backend/.env (see .env.example), e.g. the key of the AI service.
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
// The built frontend. Works both from src/ (development) and from dist/ (production).
const staticDir = process.env.FRONTEND_DIST ?? path.resolve(__dirname, '../../frontend/dist');
// While developing, the frontend runs on its own address (Vite, port 5173) and needs permission to connect.
const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : undefined;

// Behind a hosting platform's proxy (Render, for example): TRUST_PROXY=1
const trustProxy = process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY) || undefined;

const { httpServer, rooms } = createGameServer({ staticDir, corsOrigin, trustProxy });

httpServer.listen(port, host, () => {
  console.log(`Game server listening on http://localhost:${port}`);
  void rooms;
});
