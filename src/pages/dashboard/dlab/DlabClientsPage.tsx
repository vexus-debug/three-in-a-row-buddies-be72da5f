import { useState } from "react";
import { format } from "date-fns";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useClientSummaries, money } from "./dlabMoney";
import { NewCaseDialog } from "./DlabCasesPage";

export default function DlabClientsPage() {
  const { data, isLoading } = useClientSummaries();
  const [q, setQ] = useState("");
  const [newFor, setNewFor] = useState<string | null>(null);
  const list = data.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <PageHeader title="Clients" description="Clinics that send you work, with their open cases and balance.">
        <Button onClick={() => setNewFor("")}><Plus className="mr-1 h-4 w-4" />New case</Button>
      </PageHeader>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search clinics…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && !list.length && <p className="py-10 text-center text-sm text-muted-foreground">No clients yet. They appear here when you receive their first case.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => (
          <Card key={c.name}><CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="truncate font-semibold">{c.name}</p><p className="text-xs text-muted-foreground">{c.cases} cases{c.lastCase ? ` · last ${format(new Date(c.lastCase), "d MMM")}` : ""}</p></div>
              {c.late > 0 && <Badge variant="destructive">{c.late} late</Badge>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-muted p-2"><p className="text-base font-bold">{c.active}</p>Active</div>
              <div className="rounded-lg bg-muted p-2"><p className="text-sm font-bold">{money(c.billed)}</p>Billed</div>
              <div className="rounded-lg bg-muted p-2"><p className={`text-sm font-bold ${c.balance > 0 ? "text-destructive" : ""}`}>{money(c.balance)}</p>Owing</div>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => setNewFor(c.name)}><Plus className="mr-1 h-3.5 w-3.5" />New case for this clinic</Button>
          </CardContent></Card>
        ))}
      </div>
      <NewCaseDialog open={newFor !== null} onOpenChange={(o) => !o && setNewFor(null)} defaultClient={newFor || ""} />
    </div>
  );
}
