import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AccountKind, IncomeKind, LegalContext, PaymentMethod, TransactionDirection } from '@prisma/client';
import { Account, CreditCardBills, Investment, Item, PluggyClient, Transaction } from 'pluggy-sdk';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { PrismaService } from '../prisma/prisma.service';
import { ImportRuleRecord, matchesRule } from '../imports/parsers/nubank.parser';
import { LinkPluggyConnectionDto } from './dto/connect-token.dto';

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
    const connectToken = await pluggy.createConnectToken(itemId, {
      clientUserId,
      avoidDuplicates: true
    });
    return { accessToken: connectToken.accessToken, itemId: itemId ?? null };
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
      investments: investments.map((investment) => ({
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
    const reimbursementRules = await this.prisma.importMappingRule.findMany({
      where: { isActive: true, incomeKind: IncomeKind.reimbursement, userId }
    });
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
        const incomeKind =
          direction === TransactionDirection.inflow
            ? this.resolveReimbursementKind(description, reimbursementRules)
            : undefined;
        const existingTransaction = await this.prisma.transaction.findFirst({
          where: { externalId: transactionExternalId, accountId: account.id },
          select: { id: true }
        });
        if (existingTransaction) {
          await this.prisma.transaction.update({
            where: { id: existingTransaction.id },
            data: { amount, incomeKind }
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
          select: { id: true }
        });
        if (existingFingerprint) {
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
    const symbols = new Set<string>();

    for (const investment of investments) {
      const assetSymbol = investment.code || investment.isin || investment.number || investment.id;
      const quantity = investment.quantity && investment.quantity > 0 ? investment.quantity : 1;
      const currentValue = investment.balance ?? investment.amount ?? investment.value ?? 0;
      const costValue = investment.amountOriginal ?? investment.value ?? currentValue;
      const avgPrice = costValue / quantity;
      symbols.add(assetSymbol);
      await this.prisma.investmentHolding.upsert({
        where: {
          accountId_assetSymbol: {
            accountId: account.id,
            assetSymbol
          }
        },
        update: {
          assetName: investment.name,
          quantity,
          avgPrice,
          currentValue,
          assetClass: this.resolveInvestmentClass(investment)
        },
        create: {
          accountId: account.id,
          assetSymbol,
          assetName: investment.name,
          quantity,
          avgPrice,
          currentValue,
          assetClass: this.resolveInvestmentClass(investment)
        }
      });
    }

    await this.prisma.investmentHolding.deleteMany({
      where: {
        accountId: account.id,
        assetSymbol: { notIn: [...symbols] }
      }
    });
    return investments.length;
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
      transaction.paymentData?.reason
    ]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    return /pagamento recebido|pagamento.*fatura|pagamento.*cartao|credit card payment|payment received/.test(text);
  }

  private resolvePaymentMethod(transaction: Transaction, accountKind: AccountKind): PaymentMethod {
    const method = transaction.paymentData?.paymentMethod?.toUpperCase() ?? '';
    if (method.includes('PIX')) return PaymentMethod.pix;
    if (method.includes('BOLETO')) return PaymentMethod.boleto;
    if (accountKind === AccountKind.credit_card) return PaymentMethod.credit;
    return PaymentMethod.debit;
  }

  private resolveReimbursementKind(description: string, rules: ImportRuleRecord[]) {
    if (rules.some((rule) => matchesRule(description, rule))) {
      return IncomeKind.reimbursement;
    }

    const text = description
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    if (/estorno|elizama|victor da silva monteiro|droga raia|raia drogasil|ifood/.test(text)) {
      return IncomeKind.reimbursement;
    }

    return IncomeKind.other;
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
