import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Phone, Copy, Check, X, RefreshCw, MessageSquare, Loader2 } from "lucide-react";

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Expired");
        setExpired(true);
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return (
    <span className={expired ? "text-red-500" : "text-orange-500 font-mono font-medium"}>
      {remaining}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
      data-testid="button-copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function ActiveNumbers() {
  const { toast } = useToast();
  const { refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: activeOrders, isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/orders/active"],
    refetchInterval: 5000,
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: number) => { const res = await apiRequest("POST", `/api/orders/${orderId}/cancel`, {}); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      refreshUser();
      toast({ title: "Order cancelled", description: "Balance refunded" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const checkSmsMutation = useMutation({
    mutationFn: async (orderId: number) => { const res = await apiRequest("POST", `/api/orders/${orderId}/check-sms`, {}); return res.json(); },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      if (data.status === "received" && data.otpCode) {
        toast({ title: "SMS Received!", description: `OTP Code: ${data.otpCode}` });
      } else if (data.status === "received") {
        toast({ title: "SMS Received!", description: "Message found — check below" });
      } else {
        toast({ title: "No SMS yet", description: "Still waiting... Auto-refreshes every 5s." });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const parseSmsMessages = (order: any): any[] => {
    if (order.smsMessages) {
      try { return JSON.parse(order.smsMessages); } catch { return []; }
    }
    return [];
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Active Numbers</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Currently rented phone numbers</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-active">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 gap-4">
            {[1, 2].map(i => <Skeleton key={i} className="h-40" />)}
          </div>
        ) : !activeOrders || activeOrders.length === 0 ? (
          <Card className="border-border">
            <CardContent className="py-16 text-center">
              <Phone className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-semibold mb-1">No active numbers</p>
              <p className="text-sm text-muted-foreground mb-4">Buy a number to get started</p>
              <Link href="/buy">
                <a><Button size="sm">Buy a Number</Button></a>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {activeOrders.map((order: any) => {
              const messages = parseSmsMessages(order);
              const initials = (order.serviceName || "??").slice(0, 2).toUpperCase();

              return (
                <Card
                  key={order.id}
                  className={`border ${order.status === "received" ? "border-green-500/40 bg-green-500/5" : "border-border"}`}
                  data-testid={`card-order-${order.id}`}
                >
                  <CardContent className="p-5">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <span className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                          {initials}
                        </span>
                        <div>
                          <p className="font-semibold text-sm">{order.serviceName || "Service"}</p>
                          <p className="text-xs text-muted-foreground">${order.price} · US</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground mb-0.5">Expires in</p>
                        <Countdown expiresAt={order.expiresAt} />
                      </div>
                    </div>

                    {/* Phone number */}
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border border-border mb-4">
                      <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-mono flex-1 font-medium" data-testid={`text-phone-${order.id}`}>
                        {order.phoneNumber}
                      </span>
                      <CopyButton text={order.phoneNumber} />
                    </div>

                    {/* SMS Status */}
                    {order.status === "waiting" && (
                      <div className="flex items-center gap-2.5 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mb-4">
                        <div className="w-5 h-5 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin shrink-0" style={{ animationDuration: "1.5s" }} />
                        <div>
                          <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400">Waiting for SMS...</p>
                          <p className="text-xs text-muted-foreground">Use this number to verify your account</p>
                        </div>
                      </div>
                    )}

                    {order.status === "received" && (
                      <div className="space-y-2 mb-4">
                        {/* OTP code highlight */}
                        {order.otpCode && (
                          <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                            <div>
                              <p className="text-xs text-muted-foreground mb-0.5">OTP Code</p>
                              <p className="text-2xl font-bold tracking-widest text-green-600 dark:text-green-400 font-mono" data-testid={`text-otp-${order.id}`}>
                                {order.otpCode}
                              </p>
                            </div>
                            <CopyButton text={order.otpCode} />
                          </div>
                        )}

                        {/* Full SMS messages */}
                        {messages.length > 0 && (
                          <div className="p-2.5 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center gap-1.5 mb-2">
                              <MessageSquare className="w-3 h-3 text-muted-foreground" />
                              <p className="text-xs font-semibold text-muted-foreground">Full SMS</p>
                            </div>
                            {messages.map((msg: any, i: number) => (
                              <div key={i} className="text-xs text-foreground font-mono bg-background p-2 rounded border border-border mb-1 last:mb-0 break-all">
                                {msg.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      {order.status === "waiting" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 text-xs h-8"
                            onClick={() => checkSmsMutation.mutate(order.id)}
                            disabled={checkSmsMutation.isPending}
                            data-testid={`button-check-sms-${order.id}`}
                          >
                            {checkSmsMutation.isPending
                              ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Checking...</>
                              : "Check SMS"
                            }
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="text-xs h-8 px-3"
                            onClick={() => cancelMutation.mutate(order.id)}
                            disabled={cancelMutation.isPending}
                            data-testid={`button-cancel-${order.id}`}
                          >
                            <X className="w-3 h-3 mr-1" />
                            Cancel
                          </Button>
                        </>
                      )}
                      {order.status === "received" && (
                        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-xs">
                          <Check className="w-3.5 h-3.5" />
                          <span>SMS Received</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
