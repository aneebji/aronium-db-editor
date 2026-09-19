export const PAGE_SIZES = [10, 20, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export function parsePageSize(value: string | number, fallback: PageSize = 10): PageSize {
  const size = Number(value);
  return PAGE_SIZES.includes(size as PageSize) ? (size as PageSize) : fallback;
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { page: number; pages: number; slice: T[]; from: number; to: number; total: number } {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const current = Math.min(Math.max(1, page), pages);
  const start = total ? (current - 1) * pageSize : 0;
  const slice = items.slice(start, start + pageSize);
  return {
    page: current,
    pages,
    slice,
    from: total ? start + 1 : 0,
    to: start + slice.length,
    total,
  };
}

export function pagerHtml(
  id: string,
  state: { page: number; pages: number; from: number; to: number; total: number },
  pageSize: number,
): string {
  if (!state.total) return "";
  return `
    <div class="pager" data-pager="${id}">
      <span class="muted">${state.from}–${state.to} of ${state.total}</span>
      <label class="muted">Per page
        <select data-size aria-label="Rows per page">
          ${PAGE_SIZES.map(
            (size) => `<option value="${size}"${size === pageSize ? " selected" : ""}>${size}</option>`,
          ).join("")}
        </select>
      </label>
      <button type="button" class="btn ghost" data-prev${state.page <= 1 ? " disabled" : ""}>Previous</button>
      <span class="muted">Page ${state.page} of ${state.pages}</span>
      <button type="button" class="btn ghost" data-next${state.page >= state.pages ? " disabled" : ""}>Next</button>
    </div>
  `;
}

export function bindPager(
  root: HTMLElement,
  id: string,
  onChange: (next: { pageDelta?: number; pageSize?: PageSize }) => void,
): void {
  const el = root.querySelector(`[data-pager="${id}"]`);
  if (!el) return;
  el.querySelector("[data-prev]")?.addEventListener("click", () => onChange({ pageDelta: -1 }));
  el.querySelector("[data-next]")?.addEventListener("click", () => onChange({ pageDelta: 1 }));
  el.querySelector<HTMLSelectElement>("[data-size]")?.addEventListener("change", (event) => {
    onChange({ pageSize: parsePageSize((event.target as HTMLSelectElement).value) });
  });
}
