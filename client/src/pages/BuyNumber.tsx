import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Search, Globe, CheckCircle, AlertCircle } from "lucide-react";

const COUNTRIES = [
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", disabled: true },
  { code: "CA", name: "Canada", flag: "🇨🇦", disabled: true },
  { code: "AU", name: "Australia", flag: "🇦🇺", disabled: true },
];

// Category sort priority
const CATEGORY_ORDER = ["Messaging", "Social", "Tech", "Finance", "Crypto", "Shopping", "Food", "Transport", "Travel", "Entertainment", "Dating", "Other"];

export default function BuyNumber() {
  const [search, setSearch] = useState("");
  const [selectedService, setSelectedService] = useState<any>(null);
  const [selectedCountry, setSelectedCountry] = useState("US");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { toast } = useToast();
  const { refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: services, isLoading } = useQuery<any[]>({
    queryKey: ["/api/services"],
  });

  const buyMutation = useMutation({
    mutationFn: async (serviceId: number) => { const res = await apiRequest("POST", "/api/orders", { serviceId }); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      refreshUser();
      toast({ title: "Number acquired!", description: "Your number is ready. Waiting for SMS..." });
      navigate("/active");
    },
    onError: (err: any) => {
      toast({ title: "Failed to get number", description: err.message || "No numbers available or insufficient balance", variant: "destructive" });
    },
  });

  const filtered = services?.filter((s: any) => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.category?.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !activeCategory || s.category === activeCategory;
    return matchSearch && matchCategory;
  }) || [];

  const categories = [...new Set(services?.map((s: any) => s.category).filter(Boolean))].sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a) === -1 ? 999 : CATEGORY_ORDER.indexOf(a)) - (CATEGORY_ORDER.indexOf(b) === -1 ? 999 : CATEGORY_ORDER.indexOf(b))
  );

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Buy Number</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Select a service to get a real US phone number</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Service selector */}
          <div className="lg:col-span-2 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search 700+ services..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
                data-testid="input-search-services"
              />
            </div>

            {/* Category filter tabs */}
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

            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {filtered.slice(0, 60).map((svc: any) => {
                  const avail = svc.available ?? 0;
                  const lowStock = avail > 0 && avail < 50;
                  const outOfStock = avail === 0;
                  return (
                    <button
                      key={svc.id}
                      onClick={() => !outOfStock && setSelectedService(svc)}
                      disabled={outOfStock}
                      className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all
                        ${outOfStock ? "opacity-40 cursor-not-allowed border-border" : "hover:border-primary/50"}
                        ${selectedService?.id === svc.id ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border"}`}
                      data-testid={`button-service-${svc.slug}`}
                    >
                      <span className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {getInitials(svc.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{svc.name}</p>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-primary font-semibold">${svc.price}</span>
                          {lowStock && <span className="text-xs text-orange-500">· Low</span>}
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
                    Showing 60 of {filtered.length} services. Use search to find more.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right panel: country + order summary */}
          <div className="space-y-4">
            {/* Country Selector */}
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Globe className="w-4 h-4 text-primary" />
                  Country
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {COUNTRIES.map(c => (
                  <button
                    key={c.code}
                    disabled={c.disabled}
                    onClick={() => setSelectedCountry(c.code)}
                    className={`flex items-center gap-3 w-full p-2.5 rounded-lg border text-left transition-all
                      ${c.disabled ? "opacity-40 cursor-not-allowed border-border" : ""}
                      ${selectedCountry === c.code && !c.disabled ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}
                    `}
                    data-testid={`button-country-${c.code}`}
                  >
                    <span className="text-base">{c.flag}</span>
                    <span className="text-sm">{c.name}</span>
                    {c.disabled && <Badge variant="secondary" className="ml-auto text-xs h-5">Soon</Badge>}
                    {selectedCountry === c.code && !c.disabled && (
                      <CheckCircle className="w-3.5 h-3.5 text-primary ml-auto shrink-0" />
                    )}
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Order Summary */}
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Order Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedService ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Select a service to continue</p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      <span className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                        {getInitials(selectedService.name)}
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{selectedService.name}</p>
                        <p className="text-xs text-muted-foreground">US number · 20 min</p>
                      </div>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground text-xs">Service</span>
                        <span className="text-xs font-medium">{selectedService.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground text-xs">Country</span>
                        <span className="text-xs font-medium">🇺🇸 United States</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground text-xs">Duration</span>
                        <span className="text-xs font-medium">20 minutes</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground text-xs">Availability</span>
                        <span className={`text-xs font-medium ${(selectedService.available || 0) < 50 ? "text-orange-500" : "text-green-500"}`}>
                          {selectedService.available > 0 ? `${selectedService.available} numbers` : "Checking..."}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-border pt-2 mt-2">
                        <span className="text-sm font-semibold">Total</span>
                        <span className="text-sm font-bold text-primary">${selectedService.price}</span>
                      </div>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => buyMutation.mutate(selectedService.id)}
                      disabled={buyMutation.isPending}
                      data-testid="button-get-number"
                    >
                      {buyMutation.isPending ? "Requesting number..." : "Get Number"}
                    </Button>
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
