type SupabasePage<T> = {
  data: T[] | null;
  count?: number | null;
  error: { message: string } | null;
};

type SupabasePageLoader<T> = (from: number, to: number) => PromiseLike<SupabasePage<T>>;

export const SUPABASE_CONTEXT_PAGE_SIZE = 1_000;

export async function loadAllSupabaseRows<T>(
  loadPage: SupabasePageLoader<T>,
  pageSize = SUPABASE_CONTEXT_PAGE_SIZE,
  requireExactCount = false,
) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Supabase page size must be a positive integer.");

  const rows: T[] = [];
  let expectedCount: number | undefined;
  for (let from = 0; ;) {
    const { data, error, count } = await loadPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    if (requireExactCount) {
      if (!Number.isSafeInteger(count) || count! < 0 || (expectedCount !== undefined && count !== expectedCount)) {
        throw new Error("Supabase collection completeness could not be established.");
      }
      expectedCount = count!;
    }
    rows.push(...page);
    if (requireExactCount) {
      if (rows.length === expectedCount) return rows;
      if (!page.length || rows.length > expectedCount!) throw new Error("Supabase collection was incomplete.");
      from += page.length;
    } else {
      if (page.length < pageSize) return rows;
      from += pageSize;
    }
  }
}
