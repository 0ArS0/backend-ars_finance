import { Beneficiary } from '@prisma/client';

export interface BeneficiaryResponse {
  id: string;
  name: string;
  slug: string;
}

export function toBeneficiaryResponse(beneficiary: Beneficiary): BeneficiaryResponse {
  return { id: beneficiary.id, name: beneficiary.name, slug: beneficiary.slug };
}
