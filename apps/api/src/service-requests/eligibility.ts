import { sql, type SQL } from 'drizzle-orm';

/**
 * Prestador apto (GLOSSARY.md): vínculo de prestador ativo, disponível, atende a categoria, endereço do
 * pedido dentro da área de atendimento (PostGIS), sem recusa para o pedido e não é o autor do pedido.
 * Devolve pares (pedido, prestador) com a distância; os filtros escolhem o recorte.
 */
export function eligiblePairs(filter: { serviceRequestId?: string; membershipId?: string; openOnly?: boolean; broadcastOnly?: boolean }): SQL {
  return sql`
    select r.id as service_request_id,
           m.id as membership_id,
           m.user_id,
           st_distance(p.base_location::geography, r.location::geography) as meters
      from service_requests r
      join memberships m
        on m.company_id = r.company_id and m.role = 'provider' and m.active
      join provider_profiles p
        on p.membership_id = m.id and p.available and p.base_location is not null
     where r.company_id = app.current_company_id()
       ${filter.serviceRequestId ? sql`and r.id = ${filter.serviceRequestId}` : sql``}
       ${filter.membershipId ? sql`and m.id = ${filter.membershipId}` : sql``}
       ${filter.openOnly ? sql`and r.status = 'open'` : sql``}
       ${filter.broadcastOnly ? sql`and r.broadcast` : sql``}
       and m.user_id <> r.client_id
       and not app.provider_has_active_request(m.user_id)
       and exists (
         select 1 from provider_categories pc
          where pc.membership_id = m.id and pc.category_id = r.category_id
       )
       and st_dwithin(p.base_location::geography, r.location::geography, p.service_radius_km * 1000)
       and not exists (
         select 1 from service_request_declines d
          where d.service_request_id = r.id and d.provider_membership_id = m.id
       )`;
}

export type EligiblePair = {
  service_request_id: string;
  membership_id: string;
  user_id: string;
  meters: number;
};
