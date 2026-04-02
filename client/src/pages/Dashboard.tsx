import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, ShoppingCart, Phone, MessageSquare, ArrowRight, Zap } from "lucide-react";

const QUICK_SERVICES = [
  { name: "WhatsApp", icon: "📱", slug: "whatsapp" },
  { name: "Telegram", icon: "✈️", slug: "telegram" },
  { name: "Google", icon: "🔍", slug: "google" },
  { name: "Discord", icon: "💬", slug: "discord" },
];

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    waiting: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    received: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
    expired: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variants[status] || variants.expired}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orders, isLoading: ordersLoading } = useQuery<any[]>({
    queryKey: ["/api/orders"],
  });

  const { data: services } = useQuery<any[]>({
    queryKey: ["/api/services"],
  });

  const buyMutation = useMutation({
    mutationFn: async (serviceId: number) => { const res = await apiRequest("POST", "/api/orders", { serviceId }); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      refreshUser();
      toast({ title: "Number acquired!", description: "Your number is ready. Go to Active Numbers to see it." });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message || "Could not buy number", variant: "destructive" });
    },
  });

  const handleQuickBuy = (slug: string) => {
    const svc = services?.find((s: any) => s.slug === slug);
    if (!svc) return toast({ title: "Service not found", variant: "destructive" });
    buyMutation.mutate(svc.id);
  };

  const recentOrders = orders?.slice(0, 5) || [];
  const activeCount = orders?.filter((o: any) => o.status === "waiting" || o.status === "received").length || 0;
  const smsReceived = orders?.filter((o: any) => o.status === "received" || o.status === "completed").length || 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Overview of your account</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Balance", value: `$${user?.balance || "0.00"}`, icon: <DollarSign className="w-4 h-4" />, color: "text-primary", testId: "kpi-balance" },
            { label: "Active Numbers", value: activeCount, icon: <Phone className="w-4 h-4" />, color: "text-green-500", testId: "kpi-active" },
            { label: "Total Orders", value: orders?.length || 0, icon: <ShoppingCart className="w-4 h-4" />, color: "text-blue-500", testId: "kpi-orders" },
            { label: "SMS Received", value: smsReceived, icon: <MessageSquare className="w-4 h-4" />, color: "text-purple-500", testId: "kpi-sms" },
          ].map(kpi => (
            <Card key={kpi.label} className="border-border" data-testid={kpi.testId}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">{kpi.label}</span>
                  <div className={`${kpi.color}`}>{kpi.icon}</div>
                </div>
                {ordersLoading ? (
                  <Skeleton className="h-7 w-16" />
                ) : (
                  <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Quick Buy */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Quick Buy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {QUICK_SERVICES.map(svc => {
                const serviceData = services?.find((s: any) => s.slug === svc.slug);
                return (
                  <div key={svc.slug} className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:border-primary/40 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg">{svc.icon}</span>
                      <div>
                        <p className="text-sm font-medium">{svc.name}</p>
                        <p className="text-xs text-primary">${serviceData?.price || "..."}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleQuickBuy(svc.slug)}
                      disabled={buyMutation.isPending}
                      data-testid={`button-quickbuy-${svc.slug}`}
                    >
                      Buy
                    </Button>
                  </div>
                );
              })}
              <Link href="/buy">
                <a className="flex items-center justify-center gap-1 w-full py-2 text-xs text-primary hover:text-primary/80 transition-colors mt-1">
                  Browse all services <ArrowRight className="w-3 h-3" />
                </a>
              </Link>
            </CardContent>
          </Card>

          {/* Recent Orders */}
          <Card className="border-border lg:col-span-2">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Recent Orders</CardTitle>
              <Link href="/history">
                <a className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
                  View all <ArrowRight className="w-3 h-3" />
                </a>
              </Link>
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : recentOrders.length === 0 ? (
                <div className="text-center py-8">
                  <ShoppingCart className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No orders yet</p>
                  <Link href="/buy">
                    <a><Button size="sm" className="mt-3">Buy Your First Number</Button></a>
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentOrders.map((order: any) => (
                    <div key={order.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border text-sm" data-testid={`row-order-${order.id}`}>
                      <div className="flex items-center gap-3">
                        <span className="text-base">{order.service?.icon || "📱"}</span>
                        <div>
                          <p className="font-medium text-xs">{order.service?.name || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground font-mono">{order.phoneNumber}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={order.status} />
                        <span className="text-xs text-muted-foreground">${order.price}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
