import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLabCases } from "@/hooks/useLabCases";
import { useLabRecords } from "@/hooks/useLabRecords";
import { useLabInvoices } from "@/hooks/useLabInvoices";
import { clientOf } from "@/hooks/useDentalLab";

/** Loose key so "Apex Dental", "apex dental clinic" and "Apex  Dental Ltd." match. */
export const clientKey = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(dental|clinic|clinics|centre|center|ltd|limited|hospital|the)\b/g, " ")
    .replace(/\s+/g, " ").trim();

/** All known client clinic names (the client master), most-used first. */
export function useLabClientNames() {
  const cases = useLabCases();
  const invoices = useLabInvoices();
  const payments = useLabRecords("client-payments");
  const prices = useLabRecords("client-prices");
  const credits = useLabRecords("credit-notes");
  return useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    const add = (name?: string | null) => {
      if (!name?.trim() || name === "Walk-in client") return;
      const k = clientKey(name) || name.toLowerCase();
      const e = m.get(k);
      if (e) e.n++; else m.set(k, { name: name.trim(), n: 1 });
    };
    (cases.data || []).forEach((c) => add(clientOf(c)));
    (invoices.data || []).forEach((i) => add(i.clinic_code));
    [payments.data, prices.data, credits.data].forEach((l) => (l || []).forEach((r) => add(r.title)));
    return [...m.values()].sort((a, b) => b.n - a.n).map((e) => e.name);
  }, [cases.data, invoices.data, payments.data, prices.data, credits.data]);
}

/** Snap a typed name to the existing client spelling when it matches. */
export const canonicalClient = (typed: string, names: string[]) => {
  const k = clientKey(typed);
  if (!k) return typed.trim();
  return names.find((n) => clientKey(n) === k) || typed.trim();
};

/** Agreed price for a clinic + work type, if one is active. */
export function useClientPriceLookup() {
  const prices = useLabRecords("client-prices");
  return (client: string, workType: string): number | null => {
    const k = clientKey(client);
    const hit = (prices.data || []).find((p) => p.status === "active" && clientKey(p.title) === k && p.data?.work_type === workType);
    return hit ? Number(hit.amount || 0) : null;
  };
}

/** Add (or remove, with negative delta) money applied to an invoice and refresh its status. */
export async function applyToInvoice(invoiceId: string, delta: number) {
  if (!invoiceId || !delta) return;
  const { data: inv, error } = await (supabase as any).from("lab_invoices").select("id,total,amount_paid").eq("id", invoiceId).single();
  if (error) throw error;
  const total = Number(inv.total || 0);
  const paid = Math.max(0, Math.min(total, Number(inv.amount_paid || 0) + delta));
  const status = paid >= total && total > 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
  const { error: e2 } = await (supabase as any).from("lab_invoices").update({ amount_paid: paid, status }).eq("id", invoiceId);
  if (e2) throw e2;
}
