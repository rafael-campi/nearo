import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';

/** Garante a API escutando numa porta (o socket precisa de um servidor de verdade). */
export async function listen(app: INestApplication): Promise<string> {
  const server = app.getHttpServer();
  if (!server.listening) await app.listen(0);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function connect(url: string, token: string): Promise<Socket> {
  const socket = io(url, { auth: { token }, transports: ['websocket'], forceNew: true });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (error) => {
      socket.disconnect();
      reject(error);
    });
  });
  return socket;
}

/** Próximo evento com esse nome (falha se não chegar a tempo). */
export function nextEvent<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Evento ${event} não chegou`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
