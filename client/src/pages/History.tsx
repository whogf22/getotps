import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Check, ChevronLeft, ChevronRight, History as HistoryIcon } from "lucide-react";
import { useState as useClipboard } from "react";

function CopyOTP({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground" data-testid="button-copy-otp">
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    waiting: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    received: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    expired: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${classes[status] || classes.expired}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

const PAGE_SIZE = 10;

export default function History() {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);

  const { data: orders, isLoading } = useQuery<any[]>({
    queryKey: ["/api/orders"],
  });

  const filtered = (orders || []).filter(o => {
    if (filter === "all") return true;
    return o.status === filter;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Order History</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{orders?.length || 0} total orders</p>
          </div>
          <Select value={filter} onValueChange={v => { setFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36 h-9" data-testid="select-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="waiting">Waiting</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border">
          {isLoading ? (
            <CardContent className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </CardContent>
          ) : paginated.length === 0 ? (
            <CardContent className="py-16 text-center">
              <HistoryIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-semibold mb-1">No orders found</p>
              <p className="text-sm text-muted-foreground">
                {filter !== "all" ? "Try changing the filter" : "Your order history will appear here"}
              </p>
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
                      <th className="text-left p-3 text-xs font-semibold text-muted-foreground">OTP Code</th>
                      <th className="text-right p-3 text-xs font-semibold text-muted-foreground">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((order: any) => (
                      <tr key={order.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-history-${order.id}`}>
                        <td className="p-3 text-xs text-muted-foreground">{formatDate(order.createdAt)}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{order.service?.icon || "📱"}</span>
                            <span className="text-xs font-medium">{order.service?.name || "Unknown"}</span>
                          </div>
                        </td>
                        <td className="p-3 font-mono text-xs">{order.phoneNumber}</td>
                        <td className="p-3"><StatusBadge status={order.status} /></td>
                        <td className="p-3">
                          {order.otpCode ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-sm font-bold text-primary" data-testid={`text-otp-history-${order.id}`}>{order.otpCode}</span>
                              <CopyOTP code={order.otpCode} />
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
                  <div key={order.id} className="p-4 space-y-2" data-testid={`card-history-${order.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{order.service?.icon || "📱"}</span>
                        <span className="text-sm font-medium">{order.service?.name}</span>
                      </div>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="text-xs font-mono text-muted-foreground">{order.phoneNumber}</p>
                    {order.otpCode && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">OTP:</span>
                        <span className="font-mono font-bold text-primary">{order.otpCode}</span>
                        <CopyOTP code={order.otpCode} />
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              data-testid="button-next-page"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
