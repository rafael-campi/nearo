import { z } from 'zod';

/** Papel de um Vínculo (usuário ↔ empresa). Ver GLOSSARY.md. */
export const membershipRoleSchema = z.enum(['admin', 'provider', 'client']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
