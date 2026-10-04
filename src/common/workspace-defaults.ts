import { AccountKind, BudgetType, CategoryKind, LegalContext } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export async function ensureUserWorkspace(prisma: PrismaService, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;

    const [accountCount, categoryCount, beneficiaryCount] = await Promise.all([
      tx.financialAccount.count({ where: { userId } }),
      tx.category.count({ where: { userId } }),
      tx.beneficiary.count({ where: { userId } })
    ]);

    if (accountCount === 0) {
      await tx.financialAccount.create({
        data: {
          userId,
          name: 'Conta corrente',
          kind: AccountKind.checking,
          legalContext: LegalContext.pf,
          openingBalance: 0
        }
      });
    }

    if (categoryCount === 0) {
      await tx.category.createMany({
        data: [
          { userId, name: 'Salário', kind: CategoryKind.income, budgetType: BudgetType.fixed },
          { userId, name: 'Alimentação', kind: CategoryKind.expense, budgetType: BudgetType.variable },
          { userId, name: 'Moradia', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
          { userId, name: 'Transporte', kind: CategoryKind.expense, budgetType: BudgetType.variable },
          { userId, name: 'Saúde', kind: CategoryKind.expense, budgetType: BudgetType.variable },
          { userId, name: 'Lazer', kind: CategoryKind.expense, budgetType: BudgetType.variable },
          { userId, name: 'Transferência', kind: CategoryKind.transfer, budgetType: BudgetType.fixed }
        ]
      });
    }

    if (beneficiaryCount === 0) {
      await tx.beneficiary.create({
        data: {
          userId,
          name: 'Eu',
          slug: `eu-${userId}`
        }
      });
    }
  });
}
