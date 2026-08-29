import { ImportMatchType, IncomeKind, PaymentMethod, TransactionDirection } from '@prisma/client';

export interface NubankCsvRow {
  date: string;
  amount: number;
  direction: TransactionDirection;
  externalId: string;
  description: string;
  paymentMethod: PaymentMethod;
  title: string;
  counterparty: string | null;
}

function normalizeText(value: string): string {
  return value.replace(/\uFFFD/g, '').replace(/\s+/g, ' ').trim();
}

function parseBrazilianDate(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function parseBrazilianAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, '');
  if (!trimmed) return null;

  const negative = trimmed.startsWith('-');
  let value = trimmed.replace(/^-/, '');

  if (value.includes(',') && value.includes('.')) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (value.includes(',')) {
    value = value.replace(',', '.');
  }

  const amount = Number(value);
  if (Number.isNaN(amount)) return null;
  return negative ? -amount : amount;
}

function isDataRow(parts: string[]): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(parts[0]?.trim() ?? '');
}

function detectPaymentMethod(description: string): PaymentMethod {
  const text = normalizeText(description).toLowerCase();
  if (text.includes('rdb')) return PaymentMethod.investment;
  if (text.includes('nupay') || text.includes('debito')) return PaymentMethod.debit;
  if (text.includes('pix')) return PaymentMethod.pix;
  if (text.includes('credito em conta')) return PaymentMethod.transfer;
  if (text.includes('debito em conta')) return PaymentMethod.debit;
  return PaymentMethod.pix;
}

function extractCounterparty(description: string): string | null {
  const normalized = normalizeText(description);
  const pixMatch = normalized.match(/Pix - (.+?) - (?:\d|[*])/i);
  if (pixMatch) return pixMatch[1].trim();
  const nupayMatch = normalized.match(/NuPay - (.+)$/i);
  if (nupayMatch) return nupayMatch[1].trim();
  return null;
}

export function extractTitle(description: string): string {
  const normalized = normalizeText(description);
  const counterparty = extractCounterparty(normalized);
  if (counterparty) return counterparty.slice(0, 120);

  const simple = normalized.split(' - ')[0]?.trim();
  return (simple || normalized).slice(0, 120);
}

export function buildImportExternalId(nubankId: string, direction: TransactionDirection): string {
  return `${nubankId.trim()}:${direction}`;
}

function countParsableRows(lines: string[], delimiter: string): number {
  let count = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const parts = lines[index].split(delimiter);
    if (parts.length >= 4 && isDataRow(parts)) count += 1;
  }
  return count;
}

function detectDelimiter(lines: string[]): ';' | ',' {
  const commaRows = countParsableRows(lines, ',');
  const semicolonRows = countParsableRows(lines, ';');
  if (semicolonRows > commaRows) return ';';
  if (commaRows > 0) return ',';

  const header = lines[0] ?? '';
  const semicolonCount = (header.match(/;/g) ?? []).length;
  const commaCount = (header.match(/,/g) ?? []).length;
  return semicolonCount > commaCount ? ';' : ',';
}

export function parseNubankCsv(content: string): NubankCsvRow[] {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines);
  const rows: NubankCsvRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const parts = lines[index].split(delimiter);
    if (parts.length < 4 || !isDataRow(parts)) continue;

    const [dateRaw, valueRaw, externalId, ...descriptionParts] = parts;
    const description = normalizeText(descriptionParts.join(delimiter));
    const signedAmount = parseBrazilianAmount(valueRaw);
    const date = parseBrazilianDate(dateRaw);
    if (!date || signedAmount === null || !externalId?.trim()) continue;

    const direction = signedAmount >= 0 ? TransactionDirection.inflow : TransactionDirection.outflow;

    rows.push({
      date,
      amount: Math.abs(signedAmount),
      direction,
      externalId: buildImportExternalId(externalId, direction),
      description,
      paymentMethod: detectPaymentMethod(description),
      title: extractTitle(description),
      counterparty: extractCounterparty(description)
    });
  }

  return rows;
}

export interface ImportRuleRecord {
  id: string;
  userId?: string | null;
  label: string;
  pattern: string;
  matchType: ImportMatchType;
  beneficiaryId: string | null;
  categoryId: string | null;
  targetAccountId: string | null;
  targetAccount?: { id: string; name: string } | null;
  incomeKind: IncomeKind | null;
  skip: boolean;
  priority: number;
}

function foldForMatch(value: string): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRuleRegex(rule: ImportRuleRecord): RegExp | null {
  try {
    if (rule.matchType === ImportMatchType.starts_with) {
      return new RegExp(`^${escapeRegex(foldForMatch(rule.pattern))}`, 'u');
    }

    if (rule.matchType === ImportMatchType.contains) {
      return new RegExp(escapeRegex(foldForMatch(rule.pattern)), 'u');
    }

    return new RegExp(rule.pattern, 'iu');
  } catch {
    return null;
  }
}

export function matchesRule(description: string, rule: ImportRuleRecord): boolean {
  const haystack = foldForMatch(description);

  if (rule.matchType === ImportMatchType.document) {
    const digits = haystack.replace(/\D/g, '');
    const patternDigits = rule.pattern.replace(/\D/g, '');
    return patternDigits.length > 0 && digits.includes(patternDigits);
  }

  const regex = buildRuleRegex(rule);
  if (!regex) return false;
  return regex.test(haystack);
}

const FAMILY_REIMBURSEMENT_SOURCE =
  /(?:sergio(?:\s+da\s+silva\s+monteiro)?|dilma(?:\s+cosmo)?|\blyza\b|eliseu)/u;

export function isFamilyReimbursementInflow(description: string, counterparty: string | null): boolean {
  const haystack = foldForMatch(`${description} ${counterparty ?? ''}`);
  return FAMILY_REIMBURSEMENT_SOURCE.test(haystack);
}

export function inferCategoryName(description: string, title: string): string | null {
  const text = `${description} ${title}`.toLowerCase();
  if (/uber|ifood|sabor da terra|restaurante/.test(text)) return 'Alimentação';
  if (/drogaria|rd saude|farmadez|drogarias/.test(text)) return 'Saúde';
  if (/estacio|universidade/.test(text)) return 'Software';
  if (/tim s a|internet|telefone/.test(text)) return 'Software';
  return null;
}

export function isSalaryTransfer(description: string): boolean {
  const normalized = normalizeText(description).toLowerCase();
  const digits = normalized.replace(/[^\d]/g, '');
  return digits.includes('65561571000140') || normalized.includes('65 561 571');
}

export function isSelfTransfer(
  description: string,
  counterparty: string | null,
  direction: TransactionDirection
): boolean {
  if (direction !== TransactionDirection.outflow) return false;
  if (isSalaryTransfer(description)) return false;

  const text = `${description} ${counterparty ?? ''}`.toLowerCase();
  if (!text.includes('arthur da silva monteiro')) return false;
  if (text.startsWith('eu -') || text.includes('lyza -')) return false;

  return true;
}

export function isReserveTransferRule(
  rule: Pick<ImportRuleRecord, 'label' | 'pattern' | 'categoryId' | 'targetAccountId'>,
  categoryName?: string | null
): boolean {
  if (!rule.targetAccountId) return false;
  if (categoryName?.toLowerCase() === 'reserva') return true;
  return /rdb|caixinha|resgate|aplicação/.test(`${rule.label} ${rule.pattern}`.toLowerCase());
}
