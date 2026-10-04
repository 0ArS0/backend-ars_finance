import { PrismaService } from '../../prisma/prisma.service';
import { ClassificationContext } from '../utils/inflow-classification.util';

export async function loadClassificationContext(
  prisma: PrismaService,
  userId: string
): Promise<ClassificationContext> {
  const [rules, accounts, me] = await Promise.all([
    prisma.importMappingRule.findMany({
      where: { isActive: true, userId },
      include: {
        beneficiary: { select: { slug: true } },
        category: { select: { name: true, kind: true } }
      },
      orderBy: { priority: 'desc' }
    }),
    prisma.financialAccount.findMany({
      where: { userId, isActive: true },
      select: { name: true }
    }),
    prisma.beneficiary.findFirst({
      where: { userId, slug: 'eu' },
      select: { name: true }
    })
  ]);

  return {
    rules,
    ownNames: [...accounts.map((account) => account.name), me?.name].filter(Boolean) as string[]
  };
}
