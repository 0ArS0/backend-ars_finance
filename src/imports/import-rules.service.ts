import { Injectable, NotFoundException } from '@nestjs/common';
import { ImportMatchType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateImportRuleDto, UpdateImportRuleDto } from './dto/import.dto';
import { ImportRuleRecord, matchesRule } from './parsers/nubank.parser';

const ruleInclude = {
  beneficiary: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true } },
  targetAccount: { select: { id: true, name: true } }
} as const;

@Injectable()
export class ImportRulesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.importMappingRule.findMany({
      where: { isActive: true, userId },
      include: ruleInclude,
      orderBy: [{ priority: 'desc' }, { label: 'asc' }]
    });
  }

  async create(userId: string, dto: CreateImportRuleDto) {
    await this.assertReferenceOwnership(userId, dto);
    const rule = await this.prisma.importMappingRule.create({
      data: {
        matchType: ImportMatchType.contains,
        userId,
        ...dto
      },
      include: ruleInclude
    });
    await this.applyIncomeKind(rule, userId);
    return rule;
  }

  async update(userId: string, id: string, dto: UpdateImportRuleDto) {
    try {
      const existing = await this.prisma.importMappingRule.findFirst({ where: { id, userId } });
      if (!existing) throw new NotFoundException('Regra não encontrada');
      await this.assertReferenceOwnership(userId, dto);
      const rule = await this.prisma.importMappingRule.update({
        where: { id: existing.id },
        data: dto,
        include: ruleInclude
      });
      await this.applyIncomeKind(rule, userId);
      return rule;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Regra não encontrada');
      }
      throw error;
    }
  }

  private async assertReferenceOwnership(
    userId: string,
    dto: { beneficiaryId?: string | null; categoryId?: string | null; targetAccountId?: string | null }
  ) {
    const [beneficiary, category, account] = await Promise.all([
      dto.beneficiaryId ? this.prisma.beneficiary.findFirst({ where: { id: dto.beneficiaryId, userId } }) : null,
      dto.categoryId ? this.prisma.category.findFirst({ where: { id: dto.categoryId, userId } }) : null,
      dto.targetAccountId
        ? this.prisma.financialAccount.findFirst({ where: { id: dto.targetAccountId, userId } })
        : null
    ]);
    if (dto.beneficiaryId && !beneficiary) throw new NotFoundException('Beneficiário não encontrado');
    if (dto.categoryId && !category) throw new NotFoundException('Categoria não encontrada');
    if (dto.targetAccountId && !account) throw new NotFoundException('Conta não encontrada');
  }

  private async applyIncomeKind(rule: ImportRuleRecord, userId: string) {
    if (rule.incomeKind === null || rule.incomeKind === undefined) return;

    const transactions = await this.prisma.transaction.findMany({
      where: { direction: 'inflow', account: { userId } },
      select: { id: true, description: true }
    });
    const matchingIds = transactions
      .filter((transaction) => matchesRule(transaction.description, rule))
      .map((transaction) => transaction.id);

    if (matchingIds.length > 0) {
      await this.prisma.transaction.updateMany({
        where: { id: { in: matchingIds } },
        data: { incomeKind: rule.incomeKind }
      });
    }
  }

  async remove(userId: string, id: string) {
    try {
      const existing = await this.prisma.importMappingRule.findFirst({ where: { id, userId } });
      if (!existing) throw new NotFoundException('Regra não encontrada');
      await this.prisma.importMappingRule.delete({ where: { id: existing.id } });
      return { success: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Regra não encontrada');
      }
      throw error;
    }
  }

  seedDefaults(
    beneficiaries: Record<string, string>,
    categories: { salary: string; food: string }
  ) {
    const rules: Prisma.ImportMappingRuleCreateManyInput[] = [
      {
        label: 'PJ → PF (CNPJ)',
        pattern: '65561571000140',
        matchType: ImportMatchType.document,
        beneficiaryId: beneficiaries.eu,
        categoryId: categories.salary,
        incomeKind: 'freelance',
        priority: 100
      },
      {
        label: 'PJ → PF (nome)',
        pattern: '65 561 571',
        matchType: ImportMatchType.contains,
        beneficiaryId: beneficiaries.eu,
        categoryId: categories.salary,
        incomeKind: 'freelance',
        priority: 99
      },
      {
        label: 'Eu (prefixo)',
        pattern: 'Eu -',
        matchType: ImportMatchType.starts_with,
        beneficiaryId: beneficiaries.eu,
        priority: 95
      },
      {
        label: 'Eu (no Pix)',
        pattern: ' - Eu - ',
        matchType: ImportMatchType.contains,
        beneficiaryId: beneficiaries.eu,
        priority: 94
      },
      {
        label: 'Lyza (dívida dela)',
        pattern: 'Lyza -',
        matchType: ImportMatchType.starts_with,
        beneficiaryId: beneficiaries.namorada,
        priority: 90
      },
      {
        label: 'Namorada (Eliseu)',
        pattern: 'Eliseu',
        matchType: ImportMatchType.contains,
        beneficiaryId: beneficiaries.namorada,
        priority: 85
      },
      {
        label: 'Pai (Sergio)',
        pattern: 'Sergio da Silva Monteiro',
        matchType: ImportMatchType.contains,
        beneficiaryId: beneficiaries.pai,
        priority: 80
      },
      {
        label: 'Mãe (Dilma)',
        pattern: 'Dilma Cosmo',
        matchType: ImportMatchType.contains,
        beneficiaryId: beneficiaries.mae,
        priority: 78
      },
      {
        label: 'Ignorar RDB (aplicação)',
        pattern: 'Aplicação RDB',
        matchType: ImportMatchType.contains,
        skip: true,
        priority: 70
      },
      {
        label: 'Ignorar RDB (resgate)',
        pattern: 'Resgate RDB',
        matchType: ImportMatchType.contains,
        skip: true,
        priority: 70
      },
      {
        label: 'Ignorar pagamento fatura',
        pattern: 'Pagamento de fatura',
        matchType: ImportMatchType.contains,
        skip: true,
        priority: 69
      },
      {
        label: 'Ignorar transferência para si',
        pattern: 'Arthur da Silva Monteiro',
        matchType: ImportMatchType.contains,
        skip: true,
        priority: 60
      }
    ];

    return this.prisma.importMappingRule.createMany({ data: rules });
  }
}
