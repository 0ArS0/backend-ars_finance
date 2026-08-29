import {
  AccountKind,
  BudgetType,
  CategoryKind,
  ImportMatchType,
  IncomeKind,
  LegalContext,
  PrismaClient
} from '@prisma/client';
import { clearDatabase } from './clear-database';

const prisma = new PrismaClient();

async function seedAccounts() {
  await prisma.financialAccount.createMany({
    data: [
      { name: 'Nubank PF', kind: AccountKind.checking, legalContext: LegalContext.pf, openingBalance: 0 },
      { name: 'Itaú PJ', kind: AccountKind.checking, legalContext: LegalContext.pj, openingBalance: 0 },
      { name: 'Cartão Nubank', kind: AccountKind.credit_card, legalContext: LegalContext.pf, creditLimit: 8000, closingDay: 3, dueDay: 10 },
      { name: 'Dinheiro', kind: AccountKind.cash, legalContext: LegalContext.pf, openingBalance: 0 },
      { name: 'Caixinha Reserva', kind: AccountKind.wallet, legalContext: LegalContext.pf, openingBalance: 0 },
      { name: 'XP Invest', kind: AccountKind.investment, legalContext: LegalContext.pf, openingBalance: 0 }
    ]
  });

  const caixinhaReserva = await prisma.financialAccount.findFirstOrThrow({ where: { name: 'Caixinha Reserva' } });
  return { caixinhaReserva: caixinhaReserva.id };
}

async function seedCategories() {
  await prisma.category.createMany({
    data: [
      { name: 'Salário', kind: CategoryKind.income, budgetType: BudgetType.fixed },
      { name: 'Reserva', kind: CategoryKind.transfer, budgetType: BudgetType.fixed },
      { name: 'Pagamento cartão', kind: CategoryKind.transfer, budgetType: BudgetType.fixed },
      { name: 'Alimentação', kind: CategoryKind.expense, budgetType: BudgetType.variable },
      { name: 'Moradia', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
      { name: 'Software', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
      { name: 'Marketing', kind: CategoryKind.expense, budgetType: BudgetType.variable },
      { name: 'Transporte', kind: CategoryKind.expense, budgetType: BudgetType.variable },
      { name: 'Saúde', kind: CategoryKind.expense, budgetType: BudgetType.variable }
    ]
  });

  const salary = await prisma.category.findFirstOrThrow({ where: { name: 'Salário' } });
  const reserve = await prisma.category.findFirstOrThrow({ where: { name: 'Reserva' } });
  const cardPayment = await prisma.category.findFirstOrThrow({ where: { name: 'Pagamento cartão' } });
  return { salary: salary.id, reserve: reserve.id, cardPayment: cardPayment.id };
}

async function seedBeneficiaries() {
  await prisma.beneficiary.createMany({
    data: [
      { name: 'Eu', slug: 'eu' },
      { name: 'Namorada', slug: 'namorada' },
      { name: 'Pai', slug: 'pai' },
      { name: 'Mãe', slug: 'mae' },
      { name: 'Irmão', slug: 'irmao' }
    ]
  });
}

async function seedImportRules(
  beneficiaries: { eu: string; namorada: string; pai: string; mae: string },
  categories: { salary: string; reserve: string; cardPayment: string },
  accounts: { caixinhaReserva: string }
) {
  await prisma.importMappingRule.createMany({
    data: [
      { label: 'Salário (PJ → PF)', pattern: '65561571000140', matchType: ImportMatchType.document, beneficiaryId: beneficiaries.eu, categoryId: categories.salary, incomeKind: IncomeKind.salary, priority: 100 },
      { label: 'Salário (PJ → PF)', pattern: '65 561 571', matchType: ImportMatchType.contains, beneficiaryId: beneficiaries.eu, categoryId: categories.salary, incomeKind: IncomeKind.salary, priority: 99 },
      { label: 'Eu (prefixo)', pattern: 'Eu -', matchType: ImportMatchType.starts_with, beneficiaryId: beneficiaries.eu, priority: 95 },
      { label: 'Eu (no Pix)', pattern: ' - Eu - ', matchType: ImportMatchType.contains, beneficiaryId: beneficiaries.eu, priority: 94 },
      { label: 'Lyza (dívida dela)', pattern: 'Lyza -', matchType: ImportMatchType.starts_with, beneficiaryId: beneficiaries.namorada, priority: 90 },
      { label: 'Namorada (Eliseu)', pattern: 'Eliseu', matchType: ImportMatchType.contains, beneficiaryId: beneficiaries.namorada, priority: 85 },
      { label: 'Pai (Sergio)', pattern: 'Sergio da Silva Monteiro', matchType: ImportMatchType.contains, beneficiaryId: beneficiaries.pai, priority: 80 },
      { label: 'Mãe (Dilma)', pattern: 'Dilma Cosmo', matchType: ImportMatchType.contains, beneficiaryId: beneficiaries.mae, priority: 78 },
      { label: 'Guardar na Caixinha Reserva', pattern: 'Aplicação RDB', matchType: ImportMatchType.contains, beneficiaryId: beneficiaries.eu, categoryId: categories.reserve, targetAccountId: accounts.caixinhaReserva, priority: 70 },
      { label: 'Resgatar da Caixinha Reserva', pattern: 'Resgate RDB', matchType: ImportMatchType.contains, beneficiaryId: beneficiaries.eu, categoryId: categories.reserve, targetAccountId: accounts.caixinhaReserva, priority: 70 },
      { label: 'Pagamento fatura cartão', pattern: 'Pagamento de fatura', matchType: ImportMatchType.contains, beneficiaryId: beneficiaries.eu, categoryId: categories.cardPayment, priority: 69 }
    ]
  });
}

async function main() {
  await clearDatabase(prisma);

  const accounts = await seedAccounts();
  const categories = await seedCategories();
  await seedBeneficiaries();

  const beneficiaryList = await prisma.beneficiary.findMany();

  await seedImportRules(
    {
      eu: beneficiaryList.find((b) => b.slug === 'eu')!.id,
      namorada: beneficiaryList.find((b) => b.slug === 'namorada')!.id,
      pai: beneficiaryList.find((b) => b.slug === 'pai')!.id,
      mae: beneficiaryList.find((b) => b.slug === 'mae')!.id
    },
    categories,
    accounts
  );

  console.log('Seed concluído: contas, categorias, titulares e regras de importação.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
