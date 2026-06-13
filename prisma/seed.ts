import { PrismaClient, TransactionAccount, TransactionCategory, TransactionType } from '@prisma/client';

const prisma = new PrismaClient();

const transactions = [
  { description: 'Salário', amount: 8500, date: '2026-04-01', type: TransactionType.income, category: TransactionCategory.fixed, account: TransactionAccount.pf },
  { description: 'Receita de clientes', amount: 4500, date: '2026-04-02', type: TransactionType.income, category: TransactionCategory.variable, account: TransactionAccount.pj },
  { description: 'Aluguel', amount: 1800, date: '2026-04-03', type: TransactionType.expense, category: TransactionCategory.fixed, account: TransactionAccount.pf },
  { description: 'Software SaaS', amount: 640, date: '2026-04-04', type: TransactionType.expense, category: TransactionCategory.fixed, account: TransactionAccount.pj },
  { description: 'Restaurante', amount: 185, date: '2026-04-15', type: TransactionType.expense, category: TransactionCategory.variable, account: TransactionAccount.pf },
  { description: 'Material escritório', amount: 230, date: '2026-04-20', type: TransactionType.expense, category: TransactionCategory.variable, account: TransactionAccount.pj },
  { description: 'Internet + telefone', amount: 230, date: '2026-04-08', type: TransactionType.expense, category: TransactionCategory.fixed, account: TransactionAccount.pj },
  { description: 'Projeto recorrente', amount: 8200, date: '2026-03-10', type: TransactionType.income, category: TransactionCategory.fixed, account: TransactionAccount.pj },
  { description: 'Marketing', amount: 3200, date: '2026-03-18', type: TransactionType.expense, category: TransactionCategory.variable, account: TransactionAccount.pj },
  { description: 'Freela estratégico', amount: 13000, date: '2026-02-06', type: TransactionType.income, category: TransactionCategory.variable, account: TransactionAccount.pj },
  { description: 'Tributos', amount: 3400, date: '2026-02-25', type: TransactionType.expense, category: TransactionCategory.fixed, account: TransactionAccount.pj }
];

async function main() {
  await prisma.transaction.deleteMany();

  await prisma.transaction.createMany({
    data: transactions.map((item) => ({
      ...item,
      date: new Date(item.date)
    }))
  });
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
