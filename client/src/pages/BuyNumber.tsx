import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Search, CheckCircle, AlertCircle, ShoppingCart, DollarSign } from "lucide-react";

const CATEGORY_ORDER = ["Messaging", "Social", "Tech", "Finance", "Crypto", "Shopping", "Food", "Transport", "Travel", "Entertainment", "Dating", "Other"];

export default function BuyNumber() {
  const [search, setSearch] = useState("");
  const [selectedService, setSelectedService] = useState<any>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { toast } = useToast();
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: services, isLoading } = useQuery<any[]>({
    queryKey: ["/api/services"],
  });

  const buyMutation = useMutation({
    mutationFn: async (service: { id: number; slug: string }) => {
      const tryUnifiedRoute = async () => {
        const res = await apiRequest("POST", "/api/buy-number", { service: service.slug });
        return res.json();
      };
      const fallbackLegacyRoute = async () => {
        const res = await apiRequest("POST", "/api/orders", { serviceId: service.id });
        return res.json();
      };

      try {
        return await tryUnifiedRoute();
      } catch {
        return await fallbackLegacyRoute();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      refreshUser();
      toast({ title: "Number acquired!", description: "Waiting for SMS..." });
      navigate("/active");
    },
    onError: (err: any) => {
      toast({ title: "Failed to get number", description: err.message || "No numbers available or insufficient balance", variant: "destructive" });
    },
  });

  const balance = parseFloat(user?.balance || "0");

  const filtered = useMemo(() => {
    return (services || []).filter((s: any) => {
      const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.category?.toLowerCase().includes(search.toLowerCase());
      const matchCategory = !activeCategory || s.category === activeCategory;
      return matchSearch && matchCategory;
    });
  }, [services, search, activeCategory]);

  const categories = useMemo(() => {
    const cats = new Map<string, boolean>();
    (services || []).forEach((s: any) => { if (s.category) cats.set(s.category, true); });
    return Array.from(cats.keys()).sort(
      (a, b) => (CATEGORY_ORDER.indexOf(a) === -1 ? 999 : CATEGORY_ORDER.indexOf(a)) - (CATEGORY_ORDER.indexOf(b) === -1 ? 999 : CATEGORY_ORDER.indexOf(b))
    );
  }, [services]);

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Buy Number</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Select a service to get a US phone number</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
            <DollarSign className="w-3.5 h-3.5 text-primary" />
            <span className="text-sm font-bold text-primary">${user?.balance || "0.00"}</span>
          </div>
        </div>

        {/* Insufficient balance warning */}
        {balance < 0.15 && (
          <Card className="border-yellow-500/30 bg-yellow-500/[0.03]">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                <p className="text-sm">Add funds to buy a number</p>
              </div>
              <Button size="sm" className="text-xs" onClick={() => navigate("/funds")}>Add Funds</Button>
            </CardContent>
          </Card>
        )}

        <div className="grid lg:grid-cols-3 gap-5">
          {/* Service catalog */}
          <div className="lg:col-span-2 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search services..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            {/* Category filter */}
            {!search && (
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setActiveCategory(null)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    !activeCategory ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All
                </button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      activeCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}

            {/* Service grid */}
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {filtered.slice(0, 60).map((svc: any) => {
                  const avail = svc.available ?? 0;
                  const outOfStock = avail === 0;
                  const tooExpensive = balance < parseFloat(svc.price);
                  return (
                    <button
                      key={svc.id}
                      onClick={() => !outOfStock && setSelectedService(svc)}
                      disabled={outOfStock}
                      className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all
                        ${outOfStock ? "opacity-40 cursor-not-allowed border-border" : "hover:border-primary/50"}
                        ${selectedService?.id === svc.id ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border"}`}
                    >
                      <span className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {getInitials(svc.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{svc.name}</p>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-semibold ${tooExpensive ? "text-red-500" : "text-primary"}`}>${svc.price}</span>
                          {outOfStock && <span className="text-xs text-red-500">· N/A</span>}
                        </div>
                      </div>
                      {selectedService?.id === svc.id && (
                        <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="col-span-full text-center py-10 text-muted-foreground text-sm">No services found</div>
                )}
                {filtered.length > 60 && (
                  <div className="col-span-full text-center py-3 text-xs text-muted-foreground">
                    Showing 60 of {filtered.length}. Use search to find more.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Order Summary */}
          <div>
            <Card className="border-border sticky top-20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-primary" />
                  Order Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedService ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Select a service to continue</p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <span className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                        {getInitials(selectedService.name)}
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{selectedService.name}</p>
                        <p className="text-xs text-muted-foreground">US number · 20 min rental</p>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Price</span>
                        <span className="text-xs font-semibold">${selectedService.price}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Numbers available</span>
                        <span className={`text-xs font-medium ${(selectedService.available || 0) < 50 ? "text-orange-500" : "text-green-500"}`}>
                          {selectedService.available > 0 ? selectedService.available : "Checking..."}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-border pt-2 mt-2">
                        <span className="text-sm font-semibold">Total</span>
                        <span className="text-sm font-bold text-primary">${selectedService.price}</span>
                      </div>
                    </div>

                    <Button
                      className="w-full"
                      onClick={() => buyMutation.mutate({ id: selectedService.id, slug: selectedService.slug })}
                      disabled={buyMutation.isPending || balance < parseFloat(selectedService.price)}
                    >
                      {buyMutation.isPending ? "Getting number..." :
                       balance < parseFloat(selectedService.price) ? "Insufficient balance" :
                       "Get Number"}
                    </Button>

                    {balance < parseFloat(selectedService.price) && (
                      <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => navigate("/funds")}>
                        Add Funds
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
