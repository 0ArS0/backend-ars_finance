import { PrismaClient } from '@prisma/client';
import { clearDatabase } from './clear-database';

const prisma = new PrismaClient();

async function main() {
  await clearDatabase(prisma);
  console.log('Base limpa com sucesso.');
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
