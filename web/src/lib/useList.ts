import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Query } from './api';
import { useDebounced, useListState, type ListState } from './hooks';
import type { Paged } from './types';

/**
 * A server-paged list bound to URL state: search is debounced, previous page stays on screen while the next loads,
 * and `fetchAll` re-runs the same filters without paging for exports.
 */
export function usePagedList<T>(key: string, url: string, opts: { defaults?: Partial<ListState>; filterKeys?: string[]; extra?: Query; map?: (s: ListState) => Query; enabled?: boolean } = {}) {
  const [state, update] = useListState({ pageSize: 25, ...opts.defaults }, opts.filterKeys ?? []);
  const search = useDebounced(state.search, 250);
  const params: Query = {
    page: state.page, pageSize: state.pageSize, search, sortBy: state.sortBy, sortDescending: state.sortBy ? state.sortDescending : undefined,
    ...state.filters, ...(opts.map ? opts.map(state) : {}), ...opts.extra,
  };
  const query = useQuery({
    queryKey: [key, params],
    queryFn: () => api.get<Paged<T>>(url, params),
    placeholderData: keepPreviousData,
    enabled: opts.enabled !== false,
  });
  const fetchAll = async () => (await api.get<Paged<T>>(url, { ...params, page: 1, pageSize: 500 })).items;
  const tableProps = {
    rows: query.data?.items,
    loading: query.isFetching,
    error: query.error,
    onRetry: () => void query.refetch(),
    total: query.data?.totalCount,
    page: state.page,
    pageSize: state.pageSize,
    onPage: (page: number) => update({ page }, false),
    onPageSize: (pageSize: number) => update({ pageSize }),
    sortBy: state.sortBy,
    sortDescending: state.sortDescending,
    onSort: (sortBy: string, sortDescending: boolean) => update({ sortBy, sortDescending }),
  };
  return { state, update, query, tableProps, fetchAll, params };
}
