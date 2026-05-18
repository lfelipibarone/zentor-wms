"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaginationMeta } from "@/lib/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export function usePaginatedList<T>(
  loader: (page: number) => Promise<{ items: T[]; pagination: PaginationMeta }>,
  deps: unknown[] = [],
) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<T[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loader(page);
      setItems(data.items);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
      setItems([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, loader, ...deps]);

  useEffect(() => {
    setPage(1);
  }, deps);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return {
    items,
    pagination,
    page,
    setPage,
    loading,
    error,
    reload: load,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
