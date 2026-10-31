import { useMemo, useState } from "react";
import { format } from "date-fns";
import { FilePlus2, Printer, CheckCircle2, Landmark } from "lucide-react";
import { useLabRecords } from "@/hooks/useLabRecords";
import { applyToInvoice } from "./dlabLinks";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useLabCases } from "@/hooks/useLabCases";
import { useLabInvoices, useUpdateLabInvoice, type LabInvoiceRow } from "@/hooks/useLabInvoices";
import { clientOf } from "@/hooks/useDentalLab";
import { normalizeStage } from "@/config/dentalLab";
import { toast } from "sonner";
import { money } from "./dlabMoney";

const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = { paid: "default", partial: "secondary", unpaid: "destructive" };

export default function DlabInvoicesPage() {
  const { currentOrg } = useOrg();
  const qc = useQueryClient();
  const cases = useLabCases();
  const { data: invoices = [] } = useLabInvoices();
  const update = useUpdateLabInvoice();
  const settings = useLabRecords("invoice-settings");
  const bank = settings.data?.[0];
  const [bankOpen, setBankOpen] = useState(false);
  const [bankForm, setBankForm] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<LabInvoiceRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const invoicedIds = useMemo(() => new Set(invoices.map((i) => i.lab_case_id).filter(Boolean)), [invoices]);
  const ready = (cases.data || []).filter((c: any) => !invoicedIds.has(c.id) && ["ready", "delivered"].includes(normalizeStage(c.status)));
  const filtered = invoices.filter((i) =>
    (status === "all" || i.status === status) &&
    `${i.invoice_number} ${i.clinic_code} ${i.clinic_doctor_name} ${i.patient_name}`.toLowerCase().includes(q.toLowerCase()));
  const caseOf = (id: string | null) => (cases.data || []).find((c: any) => c.id === id) as any;

  const generate = async (c: any) => {
    if (!currentOrg) return;
    setBusy(c.id);
    try {
      const { data: num, error: e1 } = await (supabase as any).rpc("next_lab_serial", { _org_id: currentOrg.org_id, _kind: "lab_invoice", _prefix: "INV" });
      if (e1) throw e1;
      const subtotal = Number(c.lab_fee || 0), discount = Number(c.discount || 0), total = Math.max(subtotal - discount, 0);
      const { error } = await (supabase as any).from("lab_invoices").insert({
        org_id: currentOrg.org_id, invoice_number: num, lab_case_id: c.id, clinic_code: clientOf(c),
        clinic_doctor_name: c.clinic_doctor_name || c.external_contact_person || "", patient_name: c.external_patient_name || "",
        subtotal, discount, total, amount_paid: c.is_paid ? total : 0, status: c.is_paid ? "paid" : "unpaid",
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["lab_invoices"] });
      toast.success(`Invoice ${num} created`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  /** Settle the remaining balance and record it as a payment so statements stay in sync. */
  const markPaid = async (i: LabInvoiceRow) => {
    if (!currentOrg) return;
    const due = Number(i.total_amount) - Number(i.amount_paid);
    if (due <= 0) return;
    setBusy(i.id);
    try {
      const { error } = await (supabase as any).from("lab_records").insert({
        org_id: currentOrg.org_id, kind: "client-payments", title: i.clinic_code, status: "received", amount: due,
        record_date: format(new Date(), "yyyy-MM-dd"),
        data: { invoice_id: i.id, invoice: i.invoice_number, applied: due, method: "Transfer", reference: "Marked paid from invoices" },
      });
      if (error) throw error;
      await applyToInvoice(i.id, due);
      qc.invalidateQueries({ queryKey: ["lab_invoices"] });
      qc.invalidateQueries({ queryKey: ["lab_records"] });
      toast.success(`${i.invoice_number} paid · payment recorded`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const saveBank = async () => {
    if (!currentOrg) return;
    const payload = { title: "Invoice payment details", status: "active", amount: 0, data: bankForm };
    const q = bank
      ? (supabase as any).from("lab_records").update(payload).eq("id", bank.id)
      : (supabase as any).from("lab_records").insert({ ...payload, kind: "invoice-settings", org_id: currentOrg.org_id });
    const { error } = await q;
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["lab_records"] });
    setBankOpen(false);
    toast.success("Payment details saved");
  };

  const outstanding = invoices.reduce((s, i) => s + Number(i.total_amount) - Number(i.amount_paid), 0);

  return (
    <div className="space-y-6">
      <div className="print:hidden space-y-6">
        <PageHeader title="Invoices" description="Bill finished cases, print delivery invoices and track what clinics owe.">
          <Button variant="outline" onClick={() => { setBankForm(bank?.data || {}); setBankOpen(true); }}><Landmark className="mr-1 h-4 w-4" />Payment details</Button>
        </PageHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Invoiced</p><p className="text-xl font-semibold">{money(invoices.reduce((s, i) => s + Number(i.total_amount), 0))}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-xl font-semibold">{money(outstanding)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cases ready to bill</p><p className="text-xl font-semibold">{ready.length}</p></CardContent></Card>
        </div>

        {ready.length > 0 && (
          <Card><CardContent className="p-4 space-y-2">
            <h3 className="font-medium">Ready to invoice</h3>
            {ready.map((c: any) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0 text-sm">
                <span><b>{c.case_number}</b> · {clientOf(c)} · {c.work_type} · {money(Number(c.lab_fee || 0) - Number(c.discount || 0))}</span>
                <Button size="sm" disabled={busy === c.id} onClick={() => generate(c)}><FilePlus2 className="mr-1 h-4 w-4" />Generate invoice</Button>
              </div>
            ))}
          </CardContent></Card>
        )}

        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="Search invoice, clinic, patient…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{["all", "unpaid", "partial", "paid"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr>{["Invoice", "Date", "Clinic", "Patient", "Total", "Paid", "Status", ""].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No invoices yet.</td></tr>}
              {filtered.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="p-3 font-medium">{i.invoice_number}</td>
                  <td className="p-3">{format(new Date(i.invoice_date), "dd MMM yyyy")}</td>
                  <td className="p-3">{i.clinic_code}</td>
                  <td className="p-3">{i.patient_name || "—"}</td>
                  <td className="p-3">{money(i.total_amount)}</td>
                  <td className="p-3">{money(i.amount_paid)}</td>
                  <td className="p-3"><Badge variant={statusTone[i.status] || "outline"} className="capitalize">{i.status}</Badge></td>
                  <td className="p-3 flex gap-1 justify-end">
                    {i.status !== "paid" && <Button size="sm" variant="ghost" disabled={busy === i.id} title="Mark paid" onClick={() => markPaid(i)}><CheckCircle2 className="h-4 w-4" /></Button>}
                    <Button size="sm" variant="outline" onClick={() => setView(i)}><Printer className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      </div>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-2xl print:max-w-none print:shadow-none print:border-0">
          <DialogHeader className="print:hidden"><DialogTitle>Invoice {view?.invoice_number}</DialogTitle></DialogHeader>
          {view && <InvoiceSheet inv={view} labName={currentOrg?.org_name || "Dental Lab"} c={caseOf(view.lab_case_id)} bank={bank?.data} phone={(currentOrg as any)?.phone} />}
          <Button className="print:hidden" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print invoice</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={bankOpen} onOpenChange={setBankOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Payment details on invoices</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {BANK_FIELDS.map(([k, label]) => (
              <div key={k} className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`bank-${k}`}>{label}</label>
                <Input id={`bank-${k}`} value={bankForm[k] || ""} onChange={(e) => setBankForm({ ...bankForm, [k]: e.target.value })} />
              </div>
            ))}
            <Button className="w-full" onClick={saveBank}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const BANK_FIELDS: [string, string][] = [["bank_name", "Bank name"], ["account_name", "Account name"], ["account_number", "Account number"], ["sort_code", "Sort code / SWIFT"], ["phone", "Contact phone"]];

function InvoiceSheet({ inv, labName, c, bank, phone }: { inv: LabInvoiceRow; labName: string; c: any; bank?: Record<string, any>; phone?: string }) {
  const balance = Number(inv.total_amount) - Number(inv.amount_paid);
  return (
    <div className="space-y-5 text-sm">
      <div className="flex justify-between border-b pb-3">
        <div><h2 className="text-xl font-bold">{labName}</h2><p className="text-muted-foreground">Dental Laboratory</p></div>
        <div className="text-right"><p className="text-lg font-semibold">INVOICE</p><p>{inv.invoice_number}</p><p>{format(new Date(inv.invoice_date), "dd MMM yyyy")}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><p className="text-xs uppercase text-muted-foreground">Bill to</p><p className="font-medium">{inv.clinic_code}</p>{inv.clinic_doctor_name && <p>{inv.clinic_doctor_name}</p>}</div>
        <div><p className="text-xs uppercase text-muted-foreground">Case</p><p>{c?.case_number || "—"}</p><p>Patient: {inv.patient_name || "—"}</p></div>
      </div>
      <table className="w-full border">
        <thead className="bg-muted/50"><tr><th className="p-2 text-left">Description</th><th className="p-2 text-left">Shade / Material</th><th className="p-2 text-right">Amount</th></tr></thead>
        <tbody>
          <tr className="border-t"><td className="p-2">{c?.work_type || "Lab work"}{c?.job_description ? ` — ${c.job_description}` : ""}{c?.is_urgent ? " (Rush)" : ""}</td><td className="p-2">{[c?.shade, c?.material].filter(Boolean).join(" / ") || "—"}</td><td className="p-2 text-right">{money(inv.subtotal)}</td></tr>
        </tbody>
      </table>
      <div className="ml-auto w-60 space-y-1">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(inv.subtotal)}</span></div>
        <div className="flex justify-between"><span>Discount</span><span>-{money(inv.discount)}</span></div>
        <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span>{money(inv.total_amount)}</span></div>
        <div className="flex justify-between"><span>Paid</span><span>{money(inv.amount_paid)}</span></div>
        <div className="flex justify-between font-bold"><span>Balance due</span><span>{money(balance)}</span></div>
      </div>
      {bank && (bank.bank_name || bank.account_number) ? (
        <div className="rounded border p-3">
          <p className="mb-1 text-xs uppercase text-muted-foreground">Pay to</p>
          {bank.bank_name && <p>Bank: <b>{bank.bank_name}</b></p>}
          {bank.account_name && <p>Account name: <b>{bank.account_name}</b></p>}
          {bank.account_number && <p>Account number: <b>{bank.account_number}</b></p>}
          {bank.sort_code && <p>Sort code / SWIFT: {bank.sort_code}</p>}
          {(bank.phone || phone) && <p>Enquiries: {bank.phone || phone}</p>}
        </div>
      ) : <p className="text-xs text-muted-foreground print:hidden">Tip: add your bank details with "Payment details" so clinics know where to pay.</p>}
      <p className="border-t pt-3 text-xs text-muted-foreground">Please quote {inv.invoice_number} with your payment. Thank you for your business.</p>
    </div>
  );
}
