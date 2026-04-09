import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  ShoppingCart,
  Phone,
  MessageSquare,
  ArrowRight,
  Plus,
  Copy,
  Check,
  Clock,
  Zap,
  Wallet,
  CircleDollarSign,
} from "lucide-react";
import { useState, useEffect } from "react";

const QUICK_SERVICES = [
  { name: "WhatsApp", slug: "whatsapp" },
  { name: "Telegram", slug: "telegram" },
  { name: "Google", slug: "google" },
  { name: "Instagram", slug: "instagram" },
  { name: "Discord", slug: "discord" },
  { name: "TikTok", slug: "tiktok" },
];

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    waiting: "bg-yellow-500",
    received: "bg-green-500",
    completed: "bg-blue-500",
    cancelled: "bg-gray-400",
    expired: "bg-red-400",
  };
  return <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status] || colors.expired}`} />;
}

function MiniCountdown({ expiresAt }: { expiresAt: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setText("Expired"); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setText(`${m}:${s.toString().padStart(2, "0")}`);
    };
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, [expiresAt]);
  return <span className="text-xs font-mono text-muted-foreground">{text}</span>;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded hover:bg-accent transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: orders, isLoading: ordersLoading } = useQuery<any[]>({
    queryKey: ["/api/orders"],
  });

  const { data: activeOrders } = useQuery<any[]>({
    queryKey: ["/api/orders/active"],
    refetchInterval: 5000,
  });

  const { data: services } = useQuery<any[]>({
    queryKey: ["/api/services"],
  });

  const buyMutation = useMutation({
    mutationFn: async (serviceId: number) => {
      const res = await apiRequest("POST", "/api/orders", { serviceId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      refreshUser();
      toast({ title: "Number acquired!", description: "Go to Active Numbers to see your OTP." });
      navigate("/active");
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

  const balance = parseFloat(user?.balance || "0");
  const activeCount = activeOrders?.length || 0;
  const totalOrders = orders?.length || 0;
  const smsReceived = orders?.filter((o: any) => o.status === "received" || o.status === "completed").length || 0;
  const isNewUser = totalOrders === 0 && balance < 1;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Welcome back, {user?.username}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isNewUser ? "Get started by adding funds to your account" :
               activeCount > 0 ? `You have ${activeCount} active number${activeCount > 1 ? "s" : ""}` :
               "Here's your account overview"}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/funds">
              <a>
                <Button variant={balance < 1 ? "default" : "outline"} size="sm" className="text-xs h-9">
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add Funds
                </Button>
              </a>
            </Link>
            <Link href="/buy">
              <a>
                <Button variant={balance >= 1 ? "default" : "outline"} size="sm" className="text-xs h-9">
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
                  Buy Number
                </Button>
              </a>
            </Link>
          </div>
        </div>

        {/* New User Onboarding — only show when $0 balance and no orders */}
        {isNewUser && (
          <Card className="border-primary/30 bg-gradient-to-r from-primary/[0.04] to-transparent">
            <CardContent className="p-5">
              <h2 className="text-sm font-bold mb-4">Get your first OTP in 3 steps</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { step: "1", title: "Add Funds", desc: "Deposit USDT or other crypto", icon: Wallet, href: "/funds", active: true },
                  { step: "2", title: "Buy Number", desc: "Pick a service like WhatsApp", icon: ShoppingCart, href: "/buy", active: false },
                  { step: "3", title: "Get OTP", desc: "Receive your code instantly", icon: MessageSquare, href: "/active", active: false },
                ].map(s => (
                  <Link key={s.step} href={s.href}>
                    <a className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      s.active ? "border-primary/40 bg-primary/[0.05] hover:bg-primary/[0.08]" : "border-border hover:border-primary/20"
                    }`}>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        s.active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}>
                        <s.icon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground font-medium">Step {s.step}</p>
                        <p className="text-sm font-semibold">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{s.desc}</p>
                      </div>
                    </a>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Balance + Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border-primary/20 bg-primary/[0.03] col-span-2 lg:col-span-1">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground font-medium">Balance</span>
                <DollarSign className="w-4 h-4 text-primary" />
              </div>
              {ordersLoading ? <Skeleton className="h-9 w-24" /> : (
                <p className="text-3xl font-bold text-primary">${user?.balance || "0.00"}</p>
              )}
              {balance < 1 && !isNewUser && (
                <Link href="/funds">
                  <a className="text-xs text-primary hover:underline mt-1 inline-block">
                    Add funds to continue
                  </a>
                </Link>
              )}
            </CardContent>
          </Card>

          {[
            { label: "Active", value: activeCount, icon: Phone, color: "text-green-500" },
            { label: "Total Orders", value: totalOrders, icon: ShoppingCart, color: "text-blue-500" },
            { label: "SMS Received", value: smsReceived, icon: MessageSquare, color: "text-purple-500" },
          ].map(kpi => (
            <Card key={kpi.label} className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground font-medium">{kpi.label}</span>
                  <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                </div>
                {ordersLoading ? <Skeleton className="h-7 w-12" /> : (
                  <p className="text-2xl font-bold">{kpi.value}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Active Orders (live) — only show if there are any */}
        {activeCount > 0 && (
          <Card className="border-green-500/20">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Active Numbers ({activeCount})
              </CardTitle>
              <Link href="/active">
                <a className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
                  View all <ArrowRight className="w-3 h-3" />
                </a>
              </Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeOrders?.slice(0, 3).map((order: any) => (
                <div
                  key={order.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/20 transition-colors cursor-pointer"
                  onClick={() => navigate("/active")}
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {(order.serviceName || "??").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{order.serviceName}</p>
                      <StatusDot status={order.status} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{order.phoneNumber}</span>
                      <CopyBtn text={order.phoneNumber} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {order.otpCode ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold font-mono text-green-600 dark:text-green-400">{order.otpCode}</span>
                        <CopyBtn text={order.otpCode} />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <MiniCountdown expiresAt={order.expiresAt} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Quick Buy */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Quick Buy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {QUICK_SERVICES.map(svc => {
                const serviceData = services?.find((s: any) => s.slug === svc.slug);
                return (
                  <div key={svc.slug} className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:border-primary/30 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                        {svc.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{svc.name}</p>
                        <p className="text-xs text-primary font-semibold">${serviceData?.price || "..."}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs px-3"
                      onClick={() => handleQuickBuy(svc.slug)}
                      disabled={buyMutation.isPending || balance < parseFloat(serviceData?.price || "999")}
                    >
                      Buy
                    </Button>
                  </div>
                );
              })}
              <Link href="/buy">
                <a className="flex items-center justify-center gap-1.5 w-full py-2.5 text-xs text-primary hover:text-primary/80 transition-colors mt-1 font-medium">
                  Browse all services <ArrowRight className="w-3 h-3" />
                </a>
              </Link>
            </CardContent>
          </Card>

          {/* Recent Orders */}
          <Card className="border-border lg:col-span-2">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Recent Orders</CardTitle>
              {totalOrders > 0 && (
                <Link href="/history">
                  <a className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
                    View all <ArrowRight className="w-3 h-3" />
                  </a>
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !orders || orders.length === 0 ? (
                <div className="text-center py-8">
                  <CircleDollarSign className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium mb-1">No orders yet</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    {balance < 1
                      ? "Add funds first, then buy a number to receive OTP codes"
                      : "You have balance — buy a number to get started"}
                  </p>
                  <Link href={balance < 1 ? "/funds" : "/buy"}>
                    <a>
                      <Button size="sm">
                        {balance < 1 ? (
                          <><Plus className="w-3.5 h-3.5 mr-1.5" />Add Funds</>
                        ) : (
                          <><ShoppingCart className="w-3.5 h-3.5 mr-1.5" />Buy a Number</>
                        )}
                      </Button>
                    </a>
                  </Link>
                </div>
              ) : (
                <div className="space-y-1">
                  {orders.slice(0, 6).map((order: any) => (
                    <div key={order.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                        {(order.serviceName || "??").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{order.serviceName || "Service"}</p>
                        <p className="text-xs text-muted-foreground font-mono">{order.phoneNumber}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1.5 justify-end">
                          <StatusDot status={order.status} />
                          <span className="text-xs text-muted-foreground capitalize">{order.status}</span>
                        </div>
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
