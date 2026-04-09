import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Check, ChevronLeft, ChevronRight, History as HistoryIcon, Search, ShoppingCart } from "lucide-react";

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground"
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    waiting: "bg-yellow-500", received: "bg-green-500", completed: "bg-blue-500",
    cancelled: "bg-gray-400", expired: "bg-red-400",
  };
  return <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status] || colors.expired}`} />;
}

const PAGE_SIZE = 15;

export default function History() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data: orders, isLoading } = useQuery<any[]>({
    queryKey: ["/api/orders"],
  });

  const filtered = (orders || []).filter(o => {
    const matchFilter = filter === "all" || o.status === filter;
    const matchSearch = !search ||
      (o.serviceName || "").toLowerCase().includes(search.toLowerCase()) ||
      (o.phoneNumber || "").includes(search);
    return matchFilter && matchSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold">Order History</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{orders?.length || 0} total orders</p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by service or number..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 h-9"
            />
          </div>
          <Select value={filter} onValueChange={v => { setFilter(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="waiting">Waiting</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Orders */}
        <Card className="border-border">
          {isLoading ? (
            <CardContent className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </CardContent>
          ) : paginated.length === 0 ? (
            <CardContent className="py-16 text-center">
              <HistoryIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-semibold mb-1">No orders found</p>
              <p className="text-sm text-muted-foreground mb-4">
                {filter !== "all" || search ? "Try adjusting your filters" : "Your order history will appear here"}
              </p>
              {!search && filter === "all" && (
                <Link href="/buy">
                  <a><Button size="sm"><ShoppingCart className="w-3.5 h-3.5 mr-1.5" />Buy a Number</Button></a>
                </Link>
              )}
            </CardContent>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Date</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Service</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Number</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">Status</th>
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">OTP</th>
                      <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((order: any) => (
                      <tr key={order.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{formatDate(order.createdAt)}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                              {(order.serviceName || "??").slice(0, 2).toUpperCase()}
                            </span>
                            <span className="text-xs font-medium">{order.serviceName || "Unknown"}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs">{order.phoneNumber}</span>
                            <CopyBtn text={order.phoneNumber} />
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            <StatusDot status={order.status} />
                            <span className="text-xs capitalize">{order.status}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          {order.otpCode ? (
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-sm font-bold text-primary">{order.otpCode}</span>
                              <CopyBtn text={order.otpCode} />
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right text-xs font-semibold">${order.price}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-border">
                {paginated.map((order: any) => (
                  <div key={order.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                          {(order.serviceName || "??").slice(0, 2).toUpperCase()}
                        </span>
                        <span className="text-sm font-medium">{order.serviceName || "Unknown"}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={order.status} />
                        <span className="text-xs capitalize text-muted-foreground">{order.status}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-mono text-muted-foreground">{order.phoneNumber}</span>
                      <CopyBtn text={order.phoneNumber} />
                    </div>
                    {order.otpCode && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">OTP:</span>
                        <span className="font-mono font-bold text-primary">{order.otpCode}</span>
                        <CopyBtn text={order.otpCode} />
                      </div>
                    )}
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{formatDate(order.createdAt)}</span>
                      <span className="font-semibold text-foreground">${order.price}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
