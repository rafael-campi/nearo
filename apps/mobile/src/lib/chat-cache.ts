import type { Message, MessagePage } from '@despacho/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queries';

/**
 * Põe a mensagem nova no fim da página mais recente do chat aberto, sem rebuscar todas as páginas
 * já carregadas. Chat que não está em cache (tela nunca aberta) busca do zero ao abrir.
 */
export function appendChatMessage(queryClient: QueryClient, message: Message): void {
  queryClient.setQueryData<InfiniteData<MessagePage, string | undefined>>(queryKeys.chat(message.serviceRequestId), (data) => {
    if (!data || data.pages.length === 0) return data;
    if (data.pages.some((page) => page.messages.some((m) => m.id === message.id))) return data;
    const [newest, ...older] = data.pages;
    return { ...data, pages: [{ ...newest, messages: [...newest.messages, message] }, ...older] };
  });
}
