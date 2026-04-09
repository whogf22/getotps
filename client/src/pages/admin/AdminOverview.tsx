import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  ShoppingCart,
  DollarSign,
  Wallet,
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowDownToLine,
  Percent,
} from "lucide-react";

interface AdminStats {
  totalUsers: number;
  totalOrders: number;
  completedOrders: number;
  revenue: string;
  cost: string;
  profit: string;
  markupMultiplier: number;
  totalDeposited: string;
  pendingDeposits: number;
  tellabotBalance: string;
}

export default function AdminOverview() {
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    refetchInterval: 30000,
  });

  const { data: pendingDeposits } = useQuery<any[]>({
    queryKey: ["/api/admin/crypto/pending"],
    refetchInterval: 15000,
  });

  const profitMargin = stats
    ? parseFloat(stats.revenue) > 0
      ? (((parseFloat(stats.revenue) - parseFloat(stats.cost)) / parseFloat(stats.revenue)) * 100).toFixed(1)
      : "0.0"
    : "0.0";

  return (
    <AdminLayout title="Overview" description="System-wide metrics at a glance">
      <div className="space-y-6">
        {/* Financial Summary */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Financials</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground font-medium">Revenue</span>
                  <div className="p-2 rounded-lg bg-emerald-500/10">
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                  </div>
                </div>
                {isLoading ? <Skeleton className="h-8 w-20" /> : (
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">${stats?.revenue ?? "0.00"}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Total charged to users</p>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground font-medium">Cost</span>
                  <div className="p-2 rounded-lg bg-red-500/10">
                    <TrendingDown className="w-4 h-4 text-red-500" />
                  </div>
                </div>
                {isLoading ? <Skeleton className="h-8 w-20" /> : (
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">${stats?.cost ?? "0.00"}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Paid to TellaBot</p>
              </CardContent>
            </Card>

            <Card className="border-border border-primary/20 bg-primary/[0.02]">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground font-medium">Profit</span>
                  <div className="p-2 rounded-lg bg-primary/10">
                    <TrendingUp className="w-4 h-4 text-primary" />
                  </div>
                </div>
                {isLoading ? <Skeleton className="h-8 w-20" /> : (
                  <p className="text-2xl font-bold text-primary">${stats?.profit ?? "0.00"}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {profitMargin}% margin ({stats?.markupMultiplier ?? 1.5}x markup)
                </p>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground font-medium">Total Deposited</span>
                  <div className="p-2 rounded-lg bg-blue-500/10">
                    <ArrowDownToLine className="w-4 h-4 text-blue-500" />
                  </div>
                </div>
                {isLoading ? <Skeleton className="h-8 w-20" /> : (
                  <p className="text-2xl font-bold">${stats?.totalDeposited ?? "0.00"}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">Crypto deposits confirmed</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Operations */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Operations</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total Users", value: stats?.totalUsers ?? 0, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
              { label: "Total Orders", value: stats?.totalOrders ?? 0, icon: ShoppingCart, color: "text-green-500", bg: "bg-green-500/10" },
              { label: "Completed Orders", value: stats?.completedOrders ?? 0, icon: ShoppingCart, color: "text-cyan-500", bg: "bg-cyan-500/10" },
              { label: "TellaBot Balance", value: stats?.tellabotBalance ?? "N/A", icon: Wallet, color: "text-purple-500", bg: "bg-purple-500/10" },
            ].map(kpi => (
              <Card key={kpi.label} className="border-border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground font-medium">{kpi.label}</span>
                    <div className={`p-2 rounded-lg ${kpi.bg}`}>
                      <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                    </div>
                  </div>
                  {isLoading ? <Skeleton className="h-8 w-20" /> : (
                    <p className="text-2xl font-bold">{kpi.value}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Pending Deposits */}
        {pendingDeposits && pendingDeposits.length > 0 && (
          <Card className="border-orange-500/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" />
                Pending Deposits ({pendingDeposits.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pendingDeposits.slice(0, 5).map((dep: any) => (
                  <div key={dep.id} className="flex items-center justify-between p-3 rounded-lg border border-border text-sm">
                    <div>
                      <p className="font-medium">Deposit #{dep.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {dep.currency} - ${dep.amount} USD
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                        {dep.status}
                      </span>
                      <p className="text-xs text-muted-foreground mt-1">
                        User #{dep.userId}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
