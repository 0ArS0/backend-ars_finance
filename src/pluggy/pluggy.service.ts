import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AccountKind, CategoryKind, IncomeKind, LegalContext, PaymentMethod, TransactionDirection } from '@prisma/client';
import { Account, CreditCardBills, Investment, Item, PluggyClient, Transaction } from 'pluggy-sdk';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImportRuleRecord, matchesRule } from '../imports/parsers/nubank.parser';
import { LinkPluggyConnectionDto } from './dto/connect-token.dto';
import { isPluggyCardPaymentCategory, mapPluggyCategory } from './pluggy-category.util';

type CollectedAccount = {
  source: Account;
  transactions: Transaction[];
  bills: CreditCardBills[];
};

@Injectable()
export class PluggyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditCardsService: CreditCardsService
  ) {}

  private getClient(): PluggyClient {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'CLIENT_ID e CLIENT_SECRET devem estar configurados no .env do backend'
      );
    }

    return new PluggyClient({ clientId, clientSecret });
  }

  async createConnectToken(clientUserId: string, itemId?: string) {
    const pluggy = this.getClient();
    try {
      const connectToken = await pluggy.createConnectToken(itemId, {
        clientUserId,
        avoidDuplicates: true
      });
      return { accessToken: connectToken.accessToken, itemId: itemId ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível criar o token do Pluggy';
      throw new InternalServerErrorException(message);
    }
  }

  async listConnections(userId: string) {
    return this.prisma.pluggyConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async linkConnection(userId: string, dto: LinkPluggyConnectionDto) {
    const item = await this.getClient().fetchItem(dto.itemId);
    await this.ensureItemAccess(item, userId, true);
    const connection = await this.prisma.pluggyConnection.upsert({
      where: { userId_itemId: { userId, itemId: item.id } },
      update: {
        label: dto.label ?? item.connector.name,
        legalContext: dto.legalContext ?? 'pf',
        lastUpdatedAt: item.lastUpdatedAt ? new Date(item.lastUpdatedAt) : null
      },
      create: {
        userId,
        itemId: item.id,
        label: dto.label ?? item.connector.name,
        legalContext: dto.legalContext ?? 'pf',
        lastUpdatedAt: item.lastUpdatedAt ? new Date(item.lastUpdatedAt) : null
      }
    });
    return connection;
  }

  async previewItem(itemId: string, legalContext: LegalContext | undefined, userId: string) {
    const { item, accounts, investments } = await this.collectItem(itemId);
    await this.ensureItemAccess(item, userId, true);
    await this.saveConnection(userId, item, legalContext);
    const resolvedLegalContext = this.resolveLegalContext(item, legalContext);
    const accountExternalIds = accounts.map(({ source }) => `pluggy-account:${source.id}`);
    const transactionExternalIds = accounts.flatMap(({ transactions }) =>
      transactions.map((transaction) => `pluggy-transaction:${transaction.id}`)
    );
    const [existingAccounts, existingTransactions] = await Promise.all([
      this.prisma.financialAccount.findMany({
        where: { externalId: { in: accountExternalIds }, userId },
        select: { externalId: true }
      }),
      this.prisma.transaction.findMany({
        where: { externalId: { in: transactionExternalIds }, account: { userId } },
        select: { externalId: true }
      })
    ]);
    const existingAccountIds = new Set(existingAccounts.map((account) => account.externalId));
    const existingTransactionIds = new Set(existingTransactions.map((transaction) => transaction.externalId));

    return {
      item: { id: item.id, status: item.status, lastUpdatedAt: item.lastUpdatedAt },
      legalContext: resolvedLegalContext,
      accounts: accounts.map(({ source, transactions }) => {
        const externalId = `pluggy-account:${source.id}`;
        const kind = this.resolveAccountKind(
          source.type,
          source.subtype,
          `${source.marketingName ?? ''} ${source.name}`
        );
        const netMovement = this.calculateNetMovement(transactions, kind);
        return {
          id: source.id,
          externalId,
          name: (source.marketingName || source.name || `Conta ${source.id}`).slice(0, 120),
          type: source.type,
          subtype: source.subtype,
          kind,
          currency: source.currencyCode || 'BRL',
          balance: source.balance ?? null,
          netMovement,
          calculatedOpeningBalance: source.balance != null ? source.balance - netMovement : null,
          transactionCount: transactions.length,
          newTransactionCount: transactions.filter(
            (transaction) => !existingTransactionIds.has(`pluggy-transaction:${transaction.id}`)
          ).length,
          alreadyImported: existingAccountIds.has(externalId),
          selected: true
        };
      }),
      investments: investments.filter((investment) => this.isHeldInvestment(investment)).map((investment) => ({
        id: investment.id,
        type: investment.type,
        subtype: investment.subtype,
        name: investment.name,
        code: investment.code,
        quantity: investment.quantity,
        balance: investment.balance,
        amount: investment.amount
      })),
      transactions: accounts.flatMap(({ source, transactions }) =>
        transactions.map((transaction) => {
          const kind = this.resolveAccountKind(
            source.type,
            source.subtype,
            `${source.marketingName ?? ''} ${source.name}`
          );
          const direction = this.resolveTransactionDirection(transaction, kind);
          const isCardPayment = this.isCardPayment(transaction, kind);
          const externalId = `pluggy-transaction:${transaction.id}`;
          return {
            id: transaction.id,
            externalId,
            accountId: source.id,
            accountName: source.marketingName || source.name || `Conta ${source.id}`,
            date: this.toDateOnlyString(transaction.date),
            description: (transaction.description || 'Transação Pluggy').slice(0, 120),
            rawDescription: transaction.descriptionRaw,
            direction,
            amount: this.resolveTransactionAmount(transaction),
            originalAmount: Math.abs(transaction.amount),
            currencyCode: transaction.currencyCode,
            accountCurrency: source.currencyCode || 'BRL',
            balance: transaction.balance,
            category: transaction.category,
            categoryId: transaction.categoryId,
            cardLastDigits: transaction.creditCardMetadata?.cardNumber ?? null,
            installments: transaction.creditCardMetadata
              ? {
                  current: transaction.creditCardMetadata.installmentNumber ?? null,
                  total: transaction.creditCardMetadata.totalInstallments ?? null
                }
              : null,
            paymentMethod: this.resolvePaymentMethod(transaction, kind),
            payeeName: this.resolvePayeeName(transaction, direction),
            classification: isCardPayment ? 'Pagamento do cartão · lançado na conta bancária' : null,
            duplicate: existingTransactionIds.has(externalId),
            selected: !existingTransactionIds.has(externalId) && !isCardPayment
          };
        })
      )
    };
  }

  async importItem(
    itemId: string,
    legalContext: LegalContext | undefined,
    selectedAccountIds: string[],
    selectedTransactionIds: string[],
    userId: string
  ) {
    const { item, accounts, investments } = await this.collectItem(itemId);
    await this.ensureItemAccess(item, userId, true);
    await this.saveConnection(userId, item, legalContext);
    const resolvedLegalContext = this.resolveLegalContext(item, legalContext);
    const selectedAccounts = new Set(selectedAccountIds);
    const selectedTransactions = new Set(selectedTransactionIds);
    const defaultBeneficiary = await this.prisma.beneficiary.findFirst({ where: { slug: 'eu', userId } });
    const [importRules, existingCategories, categoryCatalog] = await Promise.all([
      this.prisma.importMappingRule.findMany({
        where: { isActive: true, userId },
        include: { beneficiary: { select: { slug: true } }, category: { select: { name: true, kind: true } } },
        orderBy: { priority: 'desc' }
      }),
      this.prisma.category.findMany({ where: { userId } }),
      this.fetchCategoryCatalog()
    ]);
    const categoryByName = new Map(existingCategories.map((category) => [category.name.toLowerCase(), category]));
    let imported = 0;
    let skipped = 0;
    let accountsImported = 0;
    const statementIds = new Set<string>();

    for (const { source, transactions, bills } of accounts) {
      if (!selectedAccounts.has(source.id)) continue;

      const selectedSourceTransactions = transactions.filter((transaction) =>
        selectedTransactions.has(transaction.id)
      );
      const kind = this.resolveAccountKind(
        source.type,
        source.subtype,
        `${source.marketingName ?? ''} ${source.name}`
      );
      const externalId = `pluggy-account:${source.id}`;
      const existingAccount = await this.prisma.financialAccount.findFirst({ where: { externalId, userId } });
      const account = existingAccount
        ? await this.prisma.financialAccount.update({
            where: { id: existingAccount.id },
            data: {
              name: (source.marketingName || source.name || `Conta ${source.id}`).slice(0, 120),
              kind,
              legalContext: resolvedLegalContext,
              userId,
              currency: source.currencyCode || 'BRL',
              currentBalance: source.balance ?? undefined,
              creditLimit: source.creditData?.creditLimit ?? undefined,
              closingDay:
                this.resolveDay(source.creditData?.balanceCloseDate) ??
                (kind === AccountKind.credit_card ? 3 : undefined),
              dueDay:
                this.resolveDay(source.creditData?.balanceDueDate) ??
                (kind === AccountKind.credit_card ? 10 : undefined)
            }
          })
        : await this.prisma.financialAccount.create({
            data: {
              externalId,
              userId,
              name: (source.marketingName || source.name || `Conta ${source.id}`).slice(0, 120),
              kind,
              legalContext: resolvedLegalContext,
              currency: source.currencyCode || 'BRL',
              currentBalance: source.balance ?? undefined,
              openingBalance:
                source.balance != null
                  ? source.balance - this.calculateNetMovement(selectedSourceTransactions, kind)
                  : 0,
              creditLimit: source.creditData?.creditLimit ?? undefined,
              closingDay:
                this.resolveDay(source.creditData?.balanceCloseDate) ??
                (kind === AccountKind.credit_card ? 3 : undefined),
              dueDay:
                this.resolveDay(source.creditData?.balanceDueDate) ??
                (kind === AccountKind.credit_card ? 10 : undefined)
            }
          });
      accountsImported += existingAccount ? 0 : 1;

      for (const sourceTransaction of selectedSourceTransactions) {
        if (this.isCardPayment(sourceTransaction, kind)) continue;
        const transactionExternalId = `pluggy-transaction:${sourceTransaction.id}`;
        const transactionDate = new Date(sourceTransaction.date);
        const amount = this.resolveTransactionAmount(sourceTransaction);
        const description = (
          sourceTransaction.description ||
          sourceTransaction.descriptionRaw ||
          'Transação Pluggy'
        ).slice(0, 120);
        const notes = sourceTransaction.descriptionRaw || null;
        const direction = this.resolveTransactionDirection(sourceTransaction, kind);
        const matchedRule = this.findMatchingRule(description, importRules);
        const mappedCategory = mapPluggyCategory({
          category: sourceTransaction.category,
          categoryId: sourceTransaction.categoryId,
          catalog: categoryCatalog,
          direction
        });
        const category = await this.resolveImportCategory(
          userId,
          mappedCategory,
          matchedRule?.categoryId,
          categoryByName
        );
        const incomeKind =
          direction === TransactionDirection.inflow
            ? this.resolveIncomeKind(description, importRules, mappedCategory)
            : undefined;
        const installmentN = sourceTransaction.creditCardMetadata?.installmentNumber ?? undefined;
        const installmentTotal = sourceTransaction.creditCardMetadata?.totalInstallments ?? undefined;
        const existingTransaction = await this.prisma.transaction.findFirst({
          where: { externalId: transactionExternalId, accountId: account.id },
          select: { id: true, categoryId: true }
        });
        if (existingTransaction) {
          await this.prisma.transaction.update({
            where: { id: existingTransaction.id },
            data: {
              amount,
              incomeKind,
              categoryId: existingTransaction.categoryId ?? category?.id,
              installmentN,
              installmentTotal
            }
          });
          skipped += 1;
          continue;
        }
        const existingFingerprint = await this.prisma.transaction.findFirst({
          where: {
            accountId: account.id,
            transactionDate,
            amount,
            description,
            notes
          },
          select: { id: true, categoryId: true }
        });
        if (existingFingerprint) {
          await this.prisma.transaction.update({
            where: { id: existingFingerprint.id },
            data: {
              incomeKind,
              categoryId: existingFingerprint.categoryId ?? category?.id,
              installmentN,
              installmentTotal
            }
          });
          skipped += 1;
          continue;
        }

        const payeeName = this.resolvePayeeName(sourceTransaction, direction);
        const payeeId = payeeName ? await this.findOrCreatePayee(payeeName, userId) : undefined;
        let statementId: string | undefined;
        if (kind === AccountKind.credit_card && !this.isCardPayment(sourceTransaction, kind)) {
          const statement = await this.creditCardsService.resolveStatement(
            account.id,
            new Date(sourceTransaction.date),
            account.closingDay ?? 1,
            account.dueDay ?? 10
          );
          statementId = statement.id;
          statementIds.add(statement.id);
        }
        await this.prisma.transaction.create({
          data: {
            accountId: account.id,
            externalId: transactionExternalId,
            direction,
            paymentMethod: this.resolvePaymentMethod(sourceTransaction, kind),
            amount,
            description,
            notes: notes || undefined,
            transactionDate,
            postedDate: transactionDate,
            payeeId,
            beneficiaryId: direction === TransactionDirection.inflow ? defaultBeneficiary?.id : undefined,
            incomeKind,
            categoryId: category?.id,
            installmentN,
            installmentTotal,
            statementId
          }
        });
        imported += 1;
      }
      if (kind === AccountKind.credit_card && bills.length > 0) {
        await this.creditCardsService.syncExternalBills(account.id, bills);
      }
    }

    for (const statementId of statementIds) {
      await this.creditCardsService.refreshStatementTotal(statementId);
    }
    const investmentsImported = await this.syncInvestments(investments, item, resolvedLegalContext, userId);

    return {
      itemId,
      status: item.status,
      accountsImported,
      transactionsImported: imported,
      duplicatesSkipped: skipped,
      investmentsImported
    };
  }

  async handleWebhook(event: {
    event: string;
    eventId: string;
    itemId?: string;
    error?: unknown;
  }) {
    if (event.event === 'item/error' && event.itemId) {
      console.error('Pluggy item error:', event.itemId, event.error);
    }
  }

  private async collectItem(itemId: string) {
    const pluggy = this.getClient();
    const item = await pluggy.fetchItem(itemId);
    const sourceAccounts = (await pluggy.fetchAccounts(itemId)).results;
    const investments = await this.fetchInvestments(pluggy, itemId);
    const accounts: CollectedAccount[] = [];

    for (const source of sourceAccounts) {
      const kind = this.resolveAccountKind(source.type, source.subtype, `${source.marketingName ?? ''} ${source.name}`);
      const bills =
        kind === AccountKind.credit_card
          ? await pluggy.fetchCreditCardBills(source.id).then((response) => response.results).catch(() => [])
          : [];
      accounts.push({
        source,
        transactions: await pluggy.fetchAllTransactions(source.id),
        bills
      });
    }

    return { item, accounts, investments };
  }

  private async ensureItemAccess(item: Item, userId: string, allowLegacy = false) {
    const ownedByAnotherUser = await this.prisma.pluggyConnection.findFirst({
      where: { itemId: item.id, userId: { not: userId } },
      select: { id: true }
    });
    if (ownedByAnotherUser) {
      throw new InternalServerErrorException('Conexão Pluggy pertence a outro usuário');
    }

    const registered = await this.prisma.pluggyConnection.findUnique({
      where: { userId_itemId: { userId, itemId: item.id } },
      select: { id: true }
    });
    const isLegacyConnection = typeof item.clientUserId === 'string' && item.clientUserId.startsWith('finance-');
    if (item.clientUserId && item.clientUserId !== userId && !registered && !(allowLegacy && isLegacyConnection)) {
      throw new InternalServerErrorException('Conexão Pluggy não pertence ao usuário atual');
    }
  }

  private async saveConnection(userId: string, item: Item, legalContext?: LegalContext) {
    return this.prisma.pluggyConnection.upsert({
      where: { userId_itemId: { userId, itemId: item.id } },
      update: {
        legalContext: legalContext ?? 'pf',
        label: item.connector.name,
        lastUpdatedAt: item.lastUpdatedAt ? new Date(item.lastUpdatedAt) : null
      },
      create: {
        userId,
        itemId: item.id,
        legalContext: legalContext ?? 'pf',
        label: item.connector.name,
        lastUpdatedAt: item.lastUpdatedAt ? new Date(item.lastUpdatedAt) : null
      }
    });
  }

  private async fetchInvestments(pluggy: PluggyClient, itemId: string) {
    try {
      return (await pluggy.fetchInvestments(itemId)).results;
    } catch {
      return [] as Investment[];
    }
  }

  private async syncInvestments(investments: Investment[], item: Item, legalContext: LegalContext, userId: string) {
    if (investments.length === 0) return 0;

    const externalId = `pluggy-investments:${item.id}`;
    const existingAccount = await this.prisma.investmentAccount.findFirst({ where: { externalId, userId } });
    const account = existingAccount
      ? await this.prisma.investmentAccount.update({
          where: { id: existingAccount.id },
          data: { name: `Investimentos - ${item.connector.name}`, legalContext }
        })
      : await this.prisma.investmentAccount.create({
          data: {
            externalId,
            userId,
            name: `Investimentos - ${item.connector.name}`,
            legalContext
          }
        });
    const held = investments.filter((investment) => this.isHeldInvestment(investment));
    if (held.length === 0) {
      await this.prisma.investmentHolding.deleteMany({ where: { accountId: account.id } });
      return 0;
    }

    const latestBySymbol = new Map<string, (typeof held)[number]>();
    for (const investment of held) {
      const assetSymbol = this.investmentSymbol(investment);
      const current = latestBySymbol.get(assetSymbol);
      if (!current || this.investmentFreshness(investment) >= this.investmentFreshness(current)) {
        latestBySymbol.set(assetSymbol, investment);
      }
    }

    const symbols = [...latestBySymbol.keys()];

    for (const [assetSymbol, investment] of latestBySymbol) {
      const quantity = investment.quantity && investment.quantity > 0 ? investment.quantity : 1;
      const currentValue = this.investmentCurrentValue(investment);
      const investedAmount = this.investmentPrincipal(investment, currentValue);
      const avgPrice = quantity > 0 ? investedAmount / quantity : 0;
      await this.prisma.investmentHolding.upsert({
        where: {
          accountId_assetSymbol: {
            accountId: account.id,
            assetSymbol
          }
        },
        update: {
          assetName: this.investmentLabel(investment),
          quantity,
          avgPrice,
          investedAmount,
          currentValue,
          assetClass: this.resolveInvestmentClass(investment)
        },
        create: {
          accountId: account.id,
          assetSymbol,
          assetName: this.investmentLabel(investment),
          quantity,
          avgPrice,
          investedAmount,
          currentValue,
          assetClass: this.resolveInvestmentClass(investment)
        }
      });
    }

    await this.prisma.investmentHolding.deleteMany({
      where: {
        accountId: account.id,
        assetSymbol: { notIn: symbols }
      }
    });
    return latestBySymbol.size;
  }

  private isHeldInvestment(investment: Investment) {
    if (investment.status === 'TOTAL_WITHDRAWAL') return false;
    if (this.isIncomeOnlyInvestment(investment)) return false;
    const worth = this.investmentCurrentValue(investment);
    if (worth <= 0.009) return false;
    if (investment.quantity != null && investment.quantity <= 0 && worth <= 0.009) return false;
    return true;
  }

  private isIncomeOnlyInvestment(investment: Investment) {
    const name = `${investment.name} ${investment.subtype ?? ''}`;
    return /dividendo|jscp|juros sobre (o )?capital|rendimento creditado|coupon|cupom/i.test(name);
  }

  private investmentCurrentValue(investment: Investment) {
    return investment.balance ?? investment.amount ?? investment.value ?? 0;
  }

  private investmentPrincipal(investment: Investment, currentValue: number) {
    const original = investment.amountOriginal;
    const profit = investment.amountProfit;
    if (original != null && original > 0.009) {
      if (profit != null && Math.abs(profit) > 0.009) {
        const implied = currentValue - profit;
        const originalLooksLikeCurrent =
          currentValue > 0.009 && Math.abs(original - currentValue) / Math.max(currentValue, 1) < 0.02;
        if (implied > 0.009 && originalLooksLikeCurrent && Math.abs(implied - original) > 1) {
          return Math.round(implied * 100) / 100;
        }
      }
      return Math.round(original * 100) / 100;
    }
    if (profit != null && Math.abs(profit) > 0.009) {
      return Math.round(Math.max(0, currentValue - profit) * 100) / 100;
    }
    return Math.round(currentValue * 100) / 100;
  }

  private investmentSymbol(investment: Investment) {
    if (investment.isin) return `isin:${investment.isin}`;
    if (investment.code && investment.number) return `code:${investment.code}:${investment.number}`;
    const due = investment.dueDate ? this.toDateOnlyString(investment.dueDate) : '';
    const issue = investment.issueDate ? this.toDateOnlyString(investment.issueDate) : '';
    const rate = investment.rate != null ? String(investment.rate) : '';
    const name = this.foldInvestmentKey(investment.name);
    const issuer = this.foldInvestmentKey(investment.issuerCNPJ || investment.issuer || '');
    return ['cdb', name, issuer, due, issue, rate, investment.rateType ?? '', investment.subtype ?? ''].join(':').slice(0, 180);
  }

  private foldInvestmentKey(value: string) {
    return value
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private investmentFreshness(investment: Investment) {
    const stamp = investment.date ?? investment.purchaseDate ?? investment.issueDate;
    const time = stamp ? new Date(stamp).getTime() : 0;
    const worth = investment.balance ?? investment.amount ?? investment.value ?? 0;
    return time + worth / 1e9;
  }

  private investmentLabel(investment: Investment) {
    const subtype = investment.subtype?.replace(/_/g, ' ') ?? null;
    const due = investment.dueDate ? this.toDateOnlyString(investment.dueDate) : null;
    const parts = [investment.name, subtype, due, investment.rateType, investment.rate != null ? `${investment.rate}%` : null].filter(
      Boolean
    );
    return Array.from(new Set(parts)).join(' · ');
  }

  private resolveInvestmentClass(investment: Investment) {
    if (
      investment.type === 'FIXED_INCOME' ||
      investment.subtype === 'FIXED_INCOME_FUND'
    ) {
      return 'fixed_income';
    }
    if (
      investment.type === 'EQUITY' ||
      investment.type === 'ETF' ||
      investment.subtype === 'STOCK' ||
      investment.subtype === 'ETF' ||
      investment.subtype === 'REAL_ESTATE_FUND' ||
      investment.subtype === 'BDR'
    ) {
      return 'variable_income';
    }
    return 'other';
  }

  private resolveLegalContext(item: Item, legalContext?: LegalContext) {
    return legalContext ?? (item.clientUserId?.endsWith('-pj') ? LegalContext.pj : LegalContext.pf);
  }

  private calculateNetMovement(transactions: Transaction[], accountKind?: AccountKind) {
    return transactions.reduce(
      (sum, transaction) =>
        sum +
        (this.resolveTransactionDirection(transaction, accountKind) === TransactionDirection.inflow
          ? this.resolveTransactionAmount(transaction)
          : -this.resolveTransactionAmount(transaction)),
      0
    );
  }

  private resolveTransactionAmount(transaction: Transaction) {
    return Math.abs(transaction.amountInAccountCurrency ?? transaction.amount);
  }

  private toDateOnlyString(value: Date) {
    return new Date(value).toISOString().slice(0, 10);
  }

  private resolveDay(value: Date | null | undefined) {
    if (!value) return undefined;
    const day = new Date(value).getUTCDate();
    return day || undefined;
  }

  private resolveAccountKind(type: string, subtype: string, name = ''): AccountKind {
    if (type === 'CREDIT' || subtype === 'CREDIT_CARD' || /\bgold\b/i.test(name)) {
      return AccountKind.credit_card;
    }
    if (subtype === 'SAVINGS_ACCOUNT') return AccountKind.savings;
    return AccountKind.checking;
  }

  private resolveTransactionDirection(transaction: Transaction, accountKind?: AccountKind) {
    if (accountKind === AccountKind.credit_card && this.isCardPayment(transaction, accountKind)) {
      return TransactionDirection.outflow;
    }
    return transaction.type === 'CREDIT'
      ? TransactionDirection.inflow
      : TransactionDirection.outflow;
  }

  private isCardPayment(transaction: Transaction, accountKind: AccountKind) {
    if (accountKind !== AccountKind.credit_card) return false;
    const text = [
      transaction.description,
      transaction.descriptionRaw,
      transaction.paymentData?.reason,
      transaction.category
    ]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    return (
      /pagamento recebido|pagamento.*fatura|pagamento.*cartao|credit card payment|payment received/.test(text) ||
      isPluggyCardPaymentCategory(transaction.category, transaction.categoryId)
    );
  }

  private resolvePaymentMethod(transaction: Transaction, accountKind: AccountKind): PaymentMethod {
    const method = transaction.paymentData?.paymentMethod?.toUpperCase() ?? '';
    if (method.includes('PIX')) return PaymentMethod.pix;
    if (method.includes('BOLETO')) return PaymentMethod.boleto;
    if (accountKind === AccountKind.credit_card) return PaymentMethod.credit;
    return PaymentMethod.debit;
  }

  private async fetchCategoryCatalog() {
    try {
      const pluggy = this.getClient() as PluggyClient & {
        fetchCategories?: () => Promise<{ results?: Array<{
          id: string;
          description?: string;
          descriptionTranslated?: string;
          parentId?: string;
          parentDescription?: string;
        }> } | Array<{
          id: string;
          description?: string;
          descriptionTranslated?: string;
          parentId?: string;
          parentDescription?: string;
        }>>;
      };
      if (!pluggy.fetchCategories) return [];
      const response = await pluggy.fetchCategories();
      return Array.isArray(response) ? response : response.results ?? [];
    } catch {
      return [];
    }
  }

  private findMatchingRule<T extends ImportRuleRecord>(description: string, rules: T[]): T | null {
    return rules.find((rule) => matchesRule(description, rule)) ?? null;
  }

  private resolveIncomeKind(
    description: string,
    rules: Array<ImportRuleRecord & { beneficiary?: { slug?: string | null } | null }>,
    mappedCategory: ReturnType<typeof mapPluggyCategory>
  ) {
    const matched = this.findMatchingRule(description, rules);
    if (matched?.incomeKind) return matched.incomeKind;
    if (matched?.beneficiary?.slug && matched.beneficiary.slug !== 'eu') return IncomeKind.reimbursement;
    if (/reembolso/i.test(description)) return IncomeKind.reimbursement;
    if (mappedCategory?.incomeKind) return mappedCategory.incomeKind;
    if (mappedCategory?.kind === CategoryKind.income) return IncomeKind.other;
    if (mappedCategory?.roleHint === 'faturamento') return IncomeKind.other;
    return IncomeKind.other;
  }

  private async resolveImportCategory(
    userId: string,
    mapped: ReturnType<typeof mapPluggyCategory>,
    ruleCategoryId: string | null | undefined,
    categoryByName: Map<string, { id: string; name: string }>
  ) {
    if (ruleCategoryId) {
      const fromRule = [...categoryByName.values()].find((category) => category.id === ruleCategoryId);
      if (fromRule) return fromRule;
    }
    if (!mapped) return null;
    const existing = categoryByName.get(mapped.name.toLowerCase());
    if (existing) return existing;
    const created = await this.prisma.category.create({
      data: {
        userId,
        name: mapped.name,
        kind: mapped.kind,
        budgetType: mapped.budgetType
      }
    });
    categoryByName.set(created.name.toLowerCase(), created);
    return created;
  }

  private resolveReimbursementKind(description: string, rules: ImportRuleRecord[]) {
    return this.resolveIncomeKind(description, rules, null);
  }

  private resolvePayeeName(transaction: Transaction, direction: TransactionDirection) {
    return (
      transaction.merchant?.name ||
      (direction === TransactionDirection.inflow
        ? transaction.paymentData?.payer?.name
        : transaction.paymentData?.receiver?.name) ||
      null
    );
  }

  private async findOrCreatePayee(name: string, userId: string) {
    const normalizedName = name.trim().slice(0, 120);
    const existing = await this.prisma.payee.findFirst({ where: { name: normalizedName, userId } });
    if (existing) return existing.id;
    const payee = await this.prisma.payee.create({
      data: { name: normalizedName, type: 'merchant', userId }
    });
    return payee.id;
  }
}
