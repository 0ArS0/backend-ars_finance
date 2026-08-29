import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IncomeKind, PaymentMethod, TransactionDirection } from '@prisma/client';
import { netMovement } from '../common/utils/balance.util';
import { toNumber } from '../common/utils/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import { CommitImportDto, PreviewImportDto } from './dto/import.dto';
import {
  ImportRuleRecord,
  inferCategoryName,
  isFamilyReimbursementInflow,
  isSalaryTransfer,
  isReserveTransferRule,
  matchesRule,
  parseNubankCsv
} from './parsers/nubank.parser';
@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(dto: PreviewImportDto, userId: string) {
    const account = await this.prisma.financialAccount.findFirst({ where: { id: dto.accountId, userId } });
    if (!account) throw new NotFoundException('Conta não encontrada');

    const parsed = parseNubankCsv(dto.csv);
    if (parsed.length === 0) throw new BadRequestException('CSV vazio ou formato inválido');

    const [rules, beneficiaries, categories, existingIds] = await Promise.all([
      this.prisma.importMappingRule.findMany({
        where: { isActive: true, userId },
        include: {
          targetAccount: { select: { id: true, name: true } }
        },
        orderBy: [{ priority: 'desc' }, { label: 'asc' }]
      }),
      this.prisma.beneficiary.findMany({ where: { userId } }),
      this.prisma.category.findMany({ where: { userId } }),
      this.prisma.transaction.findMany({
        where: {
          account: { userId },
          externalId: {
            in: [...new Set(parsed.flatMap((row) => this.importExternalIdCandidates(row.externalId)))]
          }
        },
        select: { externalId: true, direction: true }
      })
    ]);

    const existingImports = existingIds;
    const beneficiaryById = new Map(beneficiaries.map((item) => [item.id, item]));
    const defaultEu = beneficiaries.find((item) => item.slug === 'eu');

    const categoryByName = new Map(categories.map((item) => [item.name.toLowerCase(), item.id]));
    const categoryById = new Map(categories.map((item) => [item.id, item]));
    const salaryCategoryId = categoryByName.get('salário') ?? null;

    const rows = parsed.map((row) => {
      const matchedRule = this.findMatchingRule(row.counterparty, row.description, rules as ImportRuleRecord[]);
      let skip = matchedRule?.skip ?? false;
      let beneficiaryId = matchedRule?.beneficiaryId ?? defaultEu?.id ?? null;
      let categoryId = matchedRule?.categoryId ?? null;
      let incomeKind = matchedRule?.incomeKind ?? null;
      let targetAccountId = matchedRule?.targetAccountId ?? null;
      let targetAccountName = matchedRule?.targetAccount?.name ?? null;
      let matchedRuleLabel = matchedRule?.label ?? null;

      const salaryInflow =
        row.direction === TransactionDirection.inflow && isSalaryTransfer(row.description);

      if (salaryInflow) {
        skip = false;
        beneficiaryId = beneficiaryId ?? defaultEu?.id ?? null;
        categoryId = categoryId ?? salaryCategoryId;
        incomeKind = incomeKind ?? IncomeKind.salary;
        matchedRuleLabel = matchedRuleLabel ?? 'Salário (PJ → PF)';
      }

      const familyReimbursement =
        row.direction === TransactionDirection.inflow &&
        !salaryInflow &&
        isFamilyReimbursementInflow(row.description, row.counterparty);

      if (familyReimbursement) {
        incomeKind = IncomeKind.reimbursement;
        matchedRuleLabel = 'Reembolso';
      }

      if (
        skip &&
        row.direction === TransactionDirection.inflow &&
        matchedRule?.skip &&
        /arthur da silva monteiro/i.test(matchedRule.pattern)
      ) {
        skip = false;
        matchedRuleLabel = null;
      }

      if (
        matchedRule &&
        targetAccountId &&
        !isReserveTransferRule(
          matchedRule,
          matchedRule.categoryId ? categoryById.get(matchedRule.categoryId)?.name : null
        )
      ) {
        targetAccountId = null;
        targetAccountName = null;
      }

      if (/pagamento de fatura/i.test(row.description)) {
        skip = false;
        beneficiaryId = beneficiaryId ?? defaultEu?.id ?? null;
        categoryId = categoryId ?? categoryByName.get('pagamento cartão') ?? null;
        matchedRuleLabel = matchedRuleLabel ?? 'Pagamento fatura cartão';
      }

      let skipReason: string | null = null;
      if (skip) {
        if (matchedRule?.skip) skipReason = matchedRule.label;
        else skipReason = matchedRuleLabel;
      }

      if (!categoryId) {
        const inferred = inferCategoryName(row.description, row.title);
        if (inferred) categoryId = categoryByName.get(inferred.toLowerCase()) ?? null;
      }

      if (row.direction === TransactionDirection.inflow && !incomeKind) {
        if (/reembolso/i.test(row.description)) {
          incomeKind = IncomeKind.reimbursement;
        } else if (isFamilyReimbursementInflow(row.description, row.counterparty)) {
          incomeKind = IncomeKind.reimbursement;
        } else if (/valor adicionado|pix no cr[eé]dito|estorno|cr[eé]dito em conta/i.test(row.description)) {
          incomeKind = null;
        } else if (matchedRule?.incomeKind) {
          incomeKind = matchedRule.incomeKind;
        } else {
          incomeKind = IncomeKind.other;
        }
      }

      const duplicate = this.isDuplicateImport(existingImports, row.externalId, row.direction);
      const beneficiary = beneficiaryId ? beneficiaryById.get(beneficiaryId) : null;

      return {
        externalId: row.externalId,
        transactionDate: row.date,
        description: row.title,
        rawDescription: row.description,
        amount: row.amount,
        direction: row.direction,
        paymentMethod: row.paymentMethod,
        beneficiaryId,
        beneficiaryName: beneficiary?.name ?? null,
        categoryId,
        payeeName: row.title,
        targetAccountId,
        targetAccountName,
        incomeKind: row.direction === TransactionDirection.inflow ? incomeKind : null,
        skip,
        duplicate,
        selected: !skip && !duplicate,
        matchedRule: matchedRuleLabel,
        skipReason
      };
    });

    const sortedDates = parsed.map((row) => row.date).sort();
    const periodStartDate = sortedDates[0] ?? null;
    const periodEndDate = sortedDates[sortedDates.length - 1] ?? null;
    const inferredOpeningBalance = periodStartDate
      ? await this.resolvePeriodOpeningBalance(dto.accountId, periodStartDate, toNumber(account.openingBalance))
      : null;

    const netMovement = rows
      .filter((row) => row.selected)
      .reduce((sum, row) => sum + (row.direction === TransactionDirection.inflow ? row.amount : -row.amount), 0);

    const periodOpeningBalance = inferredOpeningBalance;
    const periodClosingBalance = inferredOpeningBalance != null ? inferredOpeningBalance + netMovement : null;

    return {
      account: { id: account.id, name: account.name },
      periodStartDate,
      periodEndDate,
      periodOpeningBalance,
      periodClosingBalance,
      total: rows.length,
      importable: rows.filter((row) => row.selected).length,
      skipped: rows.filter((row) => row.skip).length,
      duplicates: rows.filter((row) => row.duplicate).length,
      rows
    };
  }

  async commit(dto: CommitImportDto, userId: string) {
    const account = await this.prisma.financialAccount.findFirst({ where: { id: dto.accountId, userId } });
    if (!account) throw new NotFoundException('Conta não encontrada');

    const selected = dto.rows.filter((row) => row.selected);
    if (selected.length === 0) throw new BadRequestException('Nenhuma linha selecionada');

    if (dto.periodOpeningBalance != null) {
      const periodStart = selected
        .map((row) => row.transactionDate)
        .sort()[0];
      const existingBefore = await this.prisma.transaction.count({
        where: {
          accountId: dto.accountId,
          transactionDate: { lt: new Date(`${periodStart}T00:00:00.000Z`) }
        }
      });

      if (existingBefore === 0) {
        await this.prisma.financialAccount.update({
          where: { id: dto.accountId },
          data: { openingBalance: dto.periodOpeningBalance }
        });
      }
    }

    let created = 0;
    let skipped = 0;

    for (const row of selected) {
      const existing = await this.findExistingImport(row.externalId, row.direction as TransactionDirection, userId);
      if (existing) {
        skipped += 1;
        continue;
      }

      let payeeId: string | undefined;
      if (row.payeeName) {
        let payee = await this.prisma.payee.findFirst({ where: { name: row.payeeName, userId } });
        if (!payee) {
        payee = await this.prisma.payee.create({ data: { name: row.payeeName, type: 'merchant', userId } });
        }
        payeeId = payee.id;
      }

      await this.prisma.transaction.create({
        data: {
          accountId: dto.accountId,
          direction: row.direction as TransactionDirection,
          paymentMethod: row.paymentMethod as PaymentMethod,
          amount: row.amount,
          description: row.targetAccountName
            ? `${row.description} → ${row.targetAccountName}`.slice(0, 120)
            : row.description.slice(0, 120),
          notes: row.targetAccountName ? `Destino: ${row.targetAccountName}` : undefined,
          transactionDate: new Date(row.transactionDate),
          postedDate: new Date(row.transactionDate),
          incomeKind: row.incomeKind,
          categoryId: row.categoryId,
          payeeId,
          beneficiaryId: row.beneficiaryId,
          externalId: row.externalId
        }
      });

      created += 1;
    }

    return { created, skipped, total: selected.length };
  }

  private importExternalIdCandidates(externalId: string): string[] {
    const legacyId = this.legacyExternalId(externalId);
    return legacyId !== externalId ? [externalId, legacyId] : [externalId];
  }

  private legacyExternalId(externalId: string): string {
    return externalId.replace(/:(inflow|outflow)$/, '');
  }

  private isDuplicateImport(
    existing: { externalId: string | null; direction: TransactionDirection }[],
    externalId: string,
    direction: TransactionDirection
  ): boolean {
    const legacyId = this.legacyExternalId(externalId);
    return existing.some(
      (item) =>
        item.externalId === externalId ||
        (item.externalId === legacyId && item.direction === direction)
    );
  }

  private findExistingImport(externalId: string, direction: TransactionDirection, userId: string) {
    const legacyId = this.legacyExternalId(externalId);
    return this.prisma.transaction.findFirst({
      where: {
        account: { userId },
        OR: [
          { externalId },
          ...(legacyId !== externalId ? [{ externalId: legacyId, direction }] : [])
        ]
      }
    });
  }

  private async resolvePeriodOpeningBalance(
    accountId: string,
    periodStartDate: string,
    accountOpeningBalance: number
  ): Promise<number | null> {
    const txsBefore = await this.prisma.transaction.findMany({
      where: {
        accountId,
        transactionDate: { lt: new Date(`${periodStartDate}T00:00:00.000Z`) }
      },
      select: { direction: true, amount: true }
    });

    if (txsBefore.length === 0) return null;

    const netBefore = netMovement(txsBefore);

    return accountOpeningBalance + netBefore;
  }

  private findMatchingRule(counterparty: string | null, description: string, rules: ImportRuleRecord[]) {
    for (const rule of rules) {
      if (matchesRule(description, rule)) return rule;
      if (counterparty && matchesRule(counterparty, rule)) return rule;
    }
    return null;
  }
}
