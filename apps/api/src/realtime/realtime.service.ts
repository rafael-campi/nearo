import { Injectable } from '@nestjs/common';
import { serviceRequestRoom, sessionRoom, userRoom } from '@despacho/shared';
import type { Server } from 'socket.io';

/** Emite eventos de socket (ADR 0005). O servidor é registrado pelo gateway ao subir. */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  toUsers(userIds: string[], event: string, payload: unknown): void {
    if (userIds.length > 0) this.server?.to(userIds.map(userRoom)).emit(event, payload);
  }

  /** Vários destinos de uma vez: quem está em mais de uma sala recebe o evento uma só vez. */
  toRooms(rooms: string[], event: string, payload: unknown): void {
    if (rooms.length > 0) this.server?.to(rooms).emit(event, payload);
  }

  /** Tira estas pessoas da sala do pedido (perderam o acesso a ele); seguem na sala delas. */
  removeFromServiceRequest(userIds: string[], serviceRequestId: string): void {
    if (userIds.length > 0) this.server?.in(userIds.map(userRoom)).socketsLeave(serviceRequestRoom(serviceRequestId));
  }

  /** Derruba os sockets de uma sessão revogada, ou de todas as sessões de uma pessoa. */
  disconnect(target: { tokenHash: string } | { userId: string }): void {
    const room = 'tokenHash' in target ? sessionRoom(target.tokenHash) : userRoom(target.userId);
    this.server?.in(room).disconnectSockets(true);
  }

  toServiceRequest(serviceRequestId: string, event: string, payload: unknown): void {
    this.server?.to(serviceRequestRoom(serviceRequestId)).emit(event, payload);
  }
}
