import { BudgetType, Category, CategoryKind } from '@prisma/client';

export interface CategoryResponse {
  id: string;
  name: string;
  parentId: string | null;
  kind: CategoryKind;
  budgetType: BudgetType | null;
}

export interface CategoryTreeNode extends CategoryResponse {
  children: CategoryTreeNode[];
}

export function toCategoryResponse(category: Category): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    parentId: category.parentId,
    kind: category.kind,
    budgetType: category.budgetType
  };
}

export function buildCategoryTree(categories: Category[]): CategoryTreeNode[] {
  const map = new Map<string, CategoryTreeNode>();
  const roots: CategoryTreeNode[] = [];

  for (const category of categories) {
    map.set(category.id, { ...toCategoryResponse(category), children: [] });
  }

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
