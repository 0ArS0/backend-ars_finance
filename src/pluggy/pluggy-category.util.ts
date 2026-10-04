import { BudgetType, CategoryKind, IncomeKind, TransactionDirection } from '@prisma/client';

export type MappedPluggyCategory = {
  name: string;
  kind: CategoryKind;
  budgetType: BudgetType;
  incomeKind?: IncomeKind;
  roleHint?: 'faturamento' | 'reembolso' | 'resgate' | 'aplicacao' | 'pagamento_fatura' | 'transferencia';
};

type CatalogEntry = {
  id: string;
  description?: string | null;
  descriptionTranslated?: string | null;
  parentId?: string | null;
  parentDescription?: string | null;
};

function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

const PARENT_MAP: Record<string, MappedPluggyCategory> = {
  income: { name: 'Salário', kind: CategoryKind.income, budgetType: BudgetType.fixed, incomeKind: IncomeKind.salary, roleHint: 'faturamento' },
  'loans and financing': { name: 'Empréstimos', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  investments: { name: 'Reserva', kind: CategoryKind.transfer, budgetType: BudgetType.fixed, roleHint: 'aplicacao' },
  'same person transfer': { name: 'Transferência própria', kind: CategoryKind.transfer, budgetType: BudgetType.fixed, roleHint: 'transferencia' },
  transfers: { name: 'Pix e transferências', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  'legal obligations': { name: 'Obrigações', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  services: { name: 'Serviços', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  shopping: { name: 'Compras', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  'digital services': { name: 'Assinaturas', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  groceries: { name: 'Alimentação', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  'food and drinks': { name: 'Alimentação', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  travel: { name: 'Viagem', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  donations: { name: 'Doações', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  gambling: { name: 'Apostas', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  taxes: { name: 'Impostos', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  'bank fees': { name: 'Tarifas', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  housing: { name: 'Moradia', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  healthcare: { name: 'Saúde', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  transportation: { name: 'Transporte', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  insurance: { name: 'Seguros', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  leisure: { name: 'Lazer', kind: CategoryKind.expense, budgetType: BudgetType.variable }
};

const LEAF_OVERRIDES: Record<string, Partial<MappedPluggyCategory> & { name?: string }> = {
  'credit card payment': { name: 'Pagamento cartão', kind: CategoryKind.transfer, budgetType: BudgetType.fixed, roleHint: 'pagamento_fatura' },
  'pagamento de cartao': { name: 'Pagamento cartão', kind: CategoryKind.transfer, budgetType: BudgetType.fixed, roleHint: 'pagamento_fatura' },
  salary: { name: 'Salário', kind: CategoryKind.income, budgetType: BudgetType.fixed, incomeKind: IncomeKind.salary, roleHint: 'faturamento' },
  telecommunications: { name: 'Assinaturas', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  internet: { name: 'Assinaturas', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  'video streaming': { name: 'Assinaturas', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  'music streaming': { name: 'Assinaturas', kind: CategoryKind.expense, budgetType: BudgetType.fixed },
  pharmacy: { name: 'Saúde', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  'taxi and ride-hailing': { name: 'Transporte', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  'eating out': { name: 'Alimentação', kind: CategoryKind.expense, budgetType: BudgetType.variable },
  'food delivery': { name: 'Alimentação', kind: CategoryKind.expense, budgetType: BudgetType.variable }
};

function lookupParent(label: string | null | undefined): MappedPluggyCategory | null {
  if (!label) return null;
  return PARENT_MAP[fold(label)] ?? null;
}

function lookupLeaf(label: string | null | undefined): Partial<MappedPluggyCategory> | null {
  if (!label) return null;
  return LEAF_OVERRIDES[fold(label)] ?? null;
}

export function mapPluggyCategory(input: {
  category?: string | null;
  categoryId?: string | null;
  catalog?: CatalogEntry[];
  direction?: TransactionDirection | string;
}): MappedPluggyCategory | null {
  const node = input.categoryId && input.catalog
    ? input.catalog.find((entry) => entry.id === input.categoryId)
    : undefined;
  const leafLabel = node?.descriptionTranslated || node?.description || input.category;
  const parentLabel = node?.parentDescription || input.category;
  const parent = lookupParent(parentLabel) ?? lookupParent(leafLabel);
  const leaf = lookupLeaf(leafLabel) ?? lookupLeaf(input.category);

  if (!parent && !leaf && !leafLabel) return null;

  const mapped: MappedPluggyCategory = {
    name: leaf?.name || parent?.name || (node?.descriptionTranslated || node?.description || input.category || 'Outras').slice(0, 80),
    kind: leaf?.kind ?? parent?.kind ?? CategoryKind.expense,
    budgetType: leaf?.budgetType ?? parent?.budgetType ?? BudgetType.variable,
    incomeKind: leaf?.incomeKind ?? parent?.incomeKind,
    roleHint: leaf?.roleHint ?? parent?.roleHint
  };

  if (mapped.roleHint === 'aplicacao' && input.direction === TransactionDirection.inflow) {
    mapped.roleHint = 'resgate';
  }

  return mapped;
}

export function isPluggyCardPaymentCategory(category?: string | null, categoryId?: string | null) {
  const text = fold(`${category ?? ''} ${categoryId ?? ''}`);
  return /credit card payment|pagamento de cartao|pagamento.*fatura/.test(text);
}
