import { useEffect, useState, useCallback } from "react";
import { Wallet, Receipt, RefreshCw, CreditCard, Landmark } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarInset,
  SidebarFooter, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type Conn = { source: string; account_type: string; status: string; last_sync_at: string | null; balance: number | null; last_transaction: string | null };
type Acct = { source: string; account: string; account_type: string; txn_count: number; last_transaction: string | null; balance: number | null };
type SyncRun = { source: string; status: string; inserted: number | null; started_at: string; finished_at: string | null };
type Status = { email: string; connections: Conn[]; accounts: Acct[]; latest_sync: SyncRun | null; transaction_count: number };
type Txn = { source: string; account_type: string; account: string; date: string; description: string; amount: number; currency: string | null; status: string | null };

const fmtDate = (t: string | null) => (t ? new Date(t).toLocaleDateString() : "—");
const fmtDateTime = (t: string | null) => (t ? new Date(t).toLocaleString() : "—");
const money = (n: number | null) =>
  n == null ? "—" : "₪" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (r.status === 401) { window.location.href = "/app/login"; throw new Error("unauthorized"); }
  return r.json();
}

function StatusDot({ status }: { status: string }) {
  const color = status === "connected" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-zinc-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function SyncHistory({ source }: { source: string }) {
  const [rows, setRows] = useState<SyncRun[] | null>(null);
  useEffect(() => {
    api<SyncRun[]>(`/app/api/syncs?source=${encodeURIComponent(source)}`).then(setRows).catch(() => {});
  }, [source]);
  if (!rows) return <p className="text-sm text-muted-foreground">Loading syncs…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No syncs yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Started</TableHead><TableHead>Rows</TableHead><TableHead>Status</TableHead><TableHead>Duration</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s, i) => {
          const dur = s.started_at && s.finished_at
            ? Math.max(0, Math.round((+new Date(s.finished_at) - +new Date(s.started_at)) / 1000)) + "s" : "—";
          return (
            <TableRow key={i}>
              <TableCell className="text-muted-foreground">{fmtDateTime(s.started_at)}</TableCell>
              <TableCell>{s.inserted ?? "—"}</TableCell>
              <TableCell><Badge variant={s.status === "done" ? "secondary" : s.status === "error" ? "destructive" : "outline"}>{s.status}</Badge></TableCell>
              <TableCell className="text-muted-foreground">{dur}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SourceCard({ conn, accounts }: { conn: Conn; accounts: Acct[] }) {
  const mine = accounts.filter((a) => a.source === conn.source);
  const Icon = conn.account_type === "card" ? CreditCard : Landmark;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" /> {conn.source}
          <StatusDot status={conn.status} />
        </CardTitle>
        {conn.account_type === "bank" && <span className="font-mono text-base font-semibold">{money(conn.balance)}</span>}
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{conn.account_type === "card" ? "Card" : "Account"}</TableHead>
              <TableHead>Txns</TableHead><TableHead>Balance</TableHead><TableHead>Last txn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mine.map((a) => (
              <TableRow key={a.account}>
                <TableCell className="font-mono">{a.account}</TableCell>
                <TableCell>{a.txn_count}</TableCell>
                <TableCell className="font-mono">{money(a.balance)}</TableCell>
                <TableCell className="text-muted-foreground">{fmtDate(a.last_transaction)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sync history</p>
          <SyncHistory source={conn.source} />
        </div>
      </CardContent>
    </Card>
  );
}

function AccountsView({ status, onSync, syncing }: { status: Status | null; onSync: () => void; syncing: boolean }) {
  if (!status) return <p className="text-muted-foreground">Loading…</p>;
  const banks = status.connections.filter((c) => c.account_type !== "card");
  const cards = status.connections.filter((c) => c.account_type === "card");
  const ls = status.latest_sync;
  const statusLine = ls
    ? ls.status === "running" ? `Syncing ${ls.source ?? ""}…` : ls.status === "done" ? "Synced" : `Sync error: ${ls.status}`
    : "";
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button onClick={onSync} disabled={syncing || ls?.status === "running"}>
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> Sync now
        </Button>
        <span className="text-sm text-muted-foreground">
          {statusLine && `${statusLine} · `}{status.transaction_count} transactions
        </span>
      </div>
      {status.connections.length === 0 && <p className="text-muted-foreground">No accounts connected yet.</p>}
      {banks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bank accounts</h2>
          {banks.map((c) => <SourceCard key={c.source} conn={c} accounts={status.accounts} />)}
        </section>
      )}
      {cards.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Credit cards</h2>
          {cards.map((c) => <SourceCard key={c.source} conn={c} accounts={status.accounts} />)}
        </section>
      )}
    </div>
  );
}

function TransactionsView() {
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api<{ transactions: Txn[] }>("/app/api/transactions?limit=1000").then((d) => setTxns(d.transactions)).catch(() => {}); }, []);
  if (!txns) return <p className="text-muted-foreground">Loading transactions…</p>;
  const filtered = txns.filter((t) => !q || (t.description || "").toLowerCase().includes(q.toLowerCase()) || t.source.includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <Input placeholder="Search description or source…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      <p className="text-sm text-muted-foreground">{filtered.length} transactions</p>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Source</TableHead>
              <TableHead>Account</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 1000).map((t, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(t.date)}</TableCell>
                <TableCell><Badge variant="outline">{t.account_type}</Badge></TableCell>
                <TableCell>{t.source}</TableCell>
                <TableCell className="font-mono text-xs">{t.account}</TableCell>
                <TableCell>{t.description}</TableCell>
                <TableCell className={`text-right font-mono ${t.amount < 0 ? "text-red-500" : "text-green-600"}`}>
                  {money(t.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<"accounts" | "transactions">("accounts");
  const [status, setStatus] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => { api<Status>("/app/api/status").then(setStatus).catch(() => {}); }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const onSync = async () => {
    setSyncing(true);
    try { await fetch("/app/sync", { method: "POST" }); } finally { setTimeout(() => setSyncing(false), 2000); }
  };

  const nav = [
    { id: "accounts" as const, label: "Accounts", icon: Wallet },
    { id: "transactions" as const, label: "Transactions", icon: Receipt },
  ];

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-3 py-4 text-lg font-semibold">moneymcp</SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav.map((n) => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton isActive={view === n.id} onClick={() => setView(n.id)}>
                      <n.icon /> {n.label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="px-3 py-3 text-xs text-muted-foreground">{status?.email}</SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <h1 className="text-sm font-medium capitalize">{view}</h1>
        </header>
        <main className="p-6">
          {view === "accounts"
            ? <AccountsView status={status} onSync={onSync} syncing={syncing} />
            : <TransactionsView />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
