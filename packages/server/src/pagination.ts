/**
 * Pagination helpers for table / array StateNodes (§5.4a).
 */

import type { ArrayStateNode, PaginationInfo, StateNode, TableStateNode } from './types.js';

export function createPagination(
  cursor: string | null,
  hasMore: boolean,
  total: number | null = null,
): PaginationInfo {
  return { cursor, has_more: hasMore, total };
}

export function attachPagination<T extends ArrayStateNode | TableStateNode>(
  node: T,
  pagination: PaginationInfo,
): T {
  return { ...node, pagination };
}

/**
 * Slice a table node's rows and attach pagination metadata.
 */
export function paginateTable(
  node: TableStateNode,
  options: {
    offset?: number;
    limit: number;
    cursor?: string | null;
    total?: number | null;
  },
): TableStateNode {
  const offset = options.offset ?? decodeOffsetCursor(options.cursor) ?? 0;
  const limit = Math.max(0, options.limit);
  const rows = node.value.slice(offset, offset + limit);
  const knownTotal = options.total ?? node.value.length;
  const nextOffset = offset + rows.length;
  const hasMore = nextOffset < (options.total ?? node.value.length);
  return {
    ...node,
    value: rows,
    pagination: {
      cursor: hasMore ? encodeOffsetCursor(nextOffset) : null,
      has_more: hasMore,
      total: knownTotal,
    },
  };
}

/**
 * Slice an array StateNode and attach pagination.
 */
export function paginateArray(
  node: ArrayStateNode,
  options: {
    offset?: number;
    limit: number;
    cursor?: string | null;
    total?: number | null;
  },
): ArrayStateNode {
  const offset = options.offset ?? decodeOffsetCursor(options.cursor) ?? 0;
  const limit = Math.max(0, options.limit);
  const items = node.value.slice(offset, offset + limit);
  const knownTotal = options.total ?? node.value.length;
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < (options.total ?? node.value.length);
  return {
    ...node,
    value: items,
    pagination: {
      cursor: hasMore ? encodeOffsetCursor(nextOffset) : null,
      has_more: hasMore,
      total: knownTotal,
    },
  };
}

export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

export function decodeOffsetCursor(cursor: string | null | undefined): number | null {
  if (cursor === null || cursor === undefined || cursor === '') return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) {
      return parsed.o;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read pagination from a state node if present. */
export function getPagination(node: StateNode): PaginationInfo | undefined {
  if (
    node &&
    typeof node === 'object' &&
    'pagination' in node &&
    (node as { pagination?: PaginationInfo }).pagination
  ) {
    return (node as { pagination: PaginationInfo }).pagination;
  }
  return undefined;
}

export function isTableNode(node: StateNode): node is TableStateNode {
  return node?.type === 'table';
}

export function isArrayNode(node: StateNode): node is ArrayStateNode {
  return node?.type === 'array';
}
