type SupabasePage<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

type SupabasePageLoader<T> = (from: number, to: number) => PromiseLike<SupabasePage<T>>;

export const SUPABASE_CONTEXT_PAGE_SIZE = 1_000;

export async function loadAllSupabaseRows<T>(
  loadPage: SupabasePageLoader<T>,
  pageSize = SUPABASE_CONTEXT_PAGE_SIZE,
) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Supabase page size must be a positive integer.");

  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
