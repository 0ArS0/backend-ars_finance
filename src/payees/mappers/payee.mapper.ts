import { Payee } from '@prisma/client';

export interface PayeeResponse {
  id: string;
  name: string;
  type: string | null;
}

export function toPayeeResponse(payee: Payee): PayeeResponse {
  return { id: payee.id, name: payee.name, type: payee.type };
}
