import {
  openRequestsChangedEventSchema,
  serviceRequestLocationEventSchema,
  serviceRequestUpdatedEventSchema,
  socketEvents,
  notificationEventSchema,
} from '@despacho/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from './config';
import { queryKeys } from './queries';
import { useSession } from './session';

/**
 * Um socket enquanto há sessão (ADR 0005). Cada evento invalida só os dados da tela afetada.
 */
export function useRealtime() {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) return;
    const socket = io(API_URL, { auth: { token }, transports: ['websocket'] });

    socket.on(socketEvents.notification, (payload: unknown) => {
      const notification = notificationEventSchema.safeParse(payload);
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      if (notification.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.openRequests(notification.data.companyId) });
      }
      if (notification.success && notification.data.type !== 'new_request') {
        const { companyId } = notification.data;
        queryClient.invalidateQueries({ queryKey: queryKeys.myRequests });
        queryClient.invalidateQueries({ queryKey: queryKeys.providerRequests(companyId) });
      }
    });
    socket.on(socketEvents.serviceRequestUpdated, (payload: unknown) => {
      const event = serviceRequestUpdatedEventSchema.safeParse(payload);
      if (event.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.myRequests });
        queryClient.invalidateQueries({ queryKey: queryKeys.providerRequests(event.data.companyId) });
      }
    });
    socket.on(socketEvents.serviceRequestLocation, (payload: unknown) => {
      const event = serviceRequestLocationEventSchema.safeParse(payload);
      if (event.success) queryClient.setQueryData(queryKeys.providerLocation(event.data.id), event.data);
    });
    socket.on(socketEvents.openRequestsChanged, (payload: unknown) => {
      const event = openRequestsChangedEventSchema.safeParse(payload);
      if (event.success) queryClient.invalidateQueries({ queryKey: queryKeys.openRequests(event.data.companyId) });
    });

    return () => {
      socket.disconnect();
    };
  }, [token, queryClient]);
}
