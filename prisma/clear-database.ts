import { PrismaClient } from '@prisma/client';

export async function clearDatabase(prisma: PrismaClient) {
  await prisma.investmentTransaction.deleteMany();
  await prisma.investmentHolding.deleteMany();
  await prisma.investmentAccount.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.importMappingRule.deleteMany();
  await prisma.creditCardStatement.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.category.deleteMany();
  await prisma.payee.deleteMany();
  await prisma.beneficiary.deleteMany();
  await prisma.financialAccount.deleteMany();
  await prisma.appSetting.deleteMany();
}
