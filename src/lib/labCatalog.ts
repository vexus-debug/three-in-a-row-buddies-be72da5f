// Pure helpers for the dental lab Catalogue & Stock (work types, material stock, shade library).
import { WORK_TYPES } from "@/config/dentalLab";
import { turnaroundFor } from "@/lib/labCalendar";

export interface CatalogRecord { id?: string; title: string; status: string; amount: number | null; record_date?: string | null; data: Record<string, any> }

export interface WorkTypeOption { name: string; price: number | null; turnaround: number; category?: string; cdt?: string; material?: string; multiUnit?: boolean }

/** Active catalogue work types first, then built-in defaults not already in the catalogue. */
export function workTypeOptions(records: CatalogRecord[]): WorkTypeOption[] {
  const out: WorkTypeOption[] = [];
  const seen = new Set<string>();
  records.filter((r) => r.status === "active" && r.title?.trim()).forEach((r) => {
    const name = r.title.trim();
    const k = name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    const t = Number(r.data?.turnaround_days);
    out.push({
      name, price: Number(r.amount) > 0 ? Number(r.amount) : null,
      turnaround: t > 0 ? Math.round(t) : turnaroundFor(name),
      category: r.data?.category, cdt: r.data?.cdt, material: r.data?.material,
      multiUnit: r.data?.multi_unit === "Yes",
    });
  });
  // Retired catalogue items are hidden, including built-in names.
  const retired = new Set(records.filter((r) => r.status === "retired").map((r) => r.title?.trim().toLowerCase()));
  WORK_TYPES.forEach((w) => {
    const k = w.toLowerCase();
    if (seen.has(k) || retired.has(k)) return;
    seen.add(k);
    out.push({ name: w, price: null, turnaround: turnaroundFor(w) });
  });
  return out;
}

/** Clinic agreed price wins; otherwise the catalogue default price; otherwise nothing. */
export const suggestedFee = (agreed: number | null, catalogPrice: number | null): number | null =>
  agreed !== null ? agreed : catalogPrice;

export type StockState = "in stock" | "low" | "used up" | "expired" | "recalled";

/** Stock state from quantity, safety minimum, expiry and recall flag. */
export function stockState(r: CatalogRecord, today: string): StockState {
  if (r.status === "recalled") return "recalled";
  if (r.record_date && r.record_date < today) return "expired";
  const qty = Number(r.amount || 0);
  const min = Number(r.data?.min_stock || 0);
  if (qty <= 0) return "used up";
  if (qty <= min) return "low";
  return "in stock";
}

/** Lots a technician may draw from: not recalled, not expired, quantity left. Soonest expiry first (FEFO). */
export function usableLots(records: CatalogRecord[], today: string) {
  return records
    .filter((r) => { const s = stockState(r, today); return s === "in stock" || s === "low"; })
    .sort((a, b) => (a.record_date || "9999-12-31").localeCompare(b.record_date || "9999-12-31"));
}

/** Lots expiring within `days` (still usable), for an early warning. */
export function expiringSoon(records: CatalogRecord[], today: string, days = 30) {
  const limit = new Date(today + "T00:00:00");
  limit.setDate(limit.getDate() + days);
  const lim = limit.toISOString().slice(0, 10);
  return records.filter((r) => r.record_date && r.record_date >= today && r.record_date <= lim && r.status !== "recalled" && Number(r.amount || 0) > 0);
}

export function stockSummary(records: CatalogRecord[], today: string) {
  const states = records.map((r) => stockState(r, today));
  return {
    lots: records.length,
    usable: states.filter((s) => s === "in stock" || s === "low").length,
    low: states.filter((s) => s === "low").length,
    expired: states.filter((s) => s === "expired").length,
    recalled: states.filter((s) => s === "recalled").length,
    expiringSoon: expiringSoon(records, today).length,
  };
}

export const STUMP_SHADES = ["ND1", "ND2", "ND3", "ND4", "ND5", "ND6", "ND7", "ND8", "ND9"];

/** Active shade codes from the library, falling back to the VITA Classical guide. */
export const VITA_CLASSICAL = ["BL1", "BL2", "BL3", "BL4", "A1", "A2", "A3", "A3.5", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4", "D2", "D3", "D4"];
export function shadeOptions(records: CatalogRecord[]): string[] {
  const lib = records.filter((r) => r.status === "active" && r.title?.trim()).map((r) => r.title.trim());
  return [...new Set([...lib, ...VITA_CLASSICAL])];
}

/** Library entry matching a case's shade (case-insensitive), for showing notes on the bench. */
export const findShade = (records: CatalogRecord[], code?: string | null) =>
  code ? records.find((r) => r.status === "active" && r.title?.trim().toLowerCase() === code.trim().toLowerCase()) : undefined;

/** Short clinical spec line for a stock lot, e.g. "14 mm · ST · A2 · 405 nm". */
export function materialSpecs(r: { data?: Record<string, any> | null }): string {
  const d = r.data || {};
  const keys = ["thickness", "translucency", "spec", "size", "wavelength", "bio_class", "platform", "interface"];
  const vals = keys.map((k) => d[k]).filter((v) => v && v !== "Not applicable");
  if (d.volume_ml) vals.push(`${d.volume_ml} ml`);
  return vals.join(" · ");
}
