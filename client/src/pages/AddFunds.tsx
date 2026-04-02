import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  Copy,
  Check,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Zap,
  Send,
  Loader2,
} from "lucide-react";

type CryptoCurrency = {
  id: string;
  name: string;
  network: string;
  address: string;
  rate: number;
};

const PRESET_AMOUNTS = [5, 10, 25, 50, 100];

const CRYPTO_ICONS: Record<string, string> = {
  BTC: "₿",
  ETH: "Ξ",
  USDT_TRC20: "₮",
  USDT_ERC20: "₮",
  USDC: "$",
  LTC: "Ł",
};

const CRYPTO_COLORS: Record<string, string> = {
  BTC: "from-orange-500 to-amber-500",
  ETH: "from-indigo-500 to-purple-500",
  USDT_TRC20: "from-emerald-500 to-green-500",
  USDT_ERC20: "from-emerald-500 to-green-500",
  USDC: "from-blue-500 to-cyan-500",
  LTC: "from-slate-400 to-slate-500",
};

export default function AddFunds() {
  const [selectedCurrency, setSelectedCurrency] = useState<string>("USDT_TRC20");
  const [selectedAmount, setSelectedAmount] = useState<number>(10);
  const [customAmount, setCustomAmount] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [activeDeposit, setActiveDeposit] = useState<any>(null);
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: currencies, isLoading: currLoading } = useQuery<CryptoCurrency[]>({
    queryKey: ["/api/crypto/currencies"],
  });

  const { data: deposits, isLoading: depLoading } = useQuery<any[]>({
    queryKey: ["/api/crypto/deposits"],
  });

  const { data: transactions, isLoading: txLoading } = useQuery<any[]>({
    queryKey: ["/api/transactions"],
  });

  const createDepositMutation = useMutation({
    mutationFn: async ({ currency, amount }: { currency: string; amount: number }) => {
      const res = await apiRequest("POST", "/api/crypto/create-deposit", { currency, amount });
      return res.json();
    },
    onSuccess: (data: any) => {
      setActiveDeposit(data);
      queryClient.invalidateQueries({ queryKey: ["/api/crypto/deposits"] });
      toast({ title: "Deposit created", description: "Send crypto to the address shown below." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const submitHashMutation = useMutation({
    mutationFn: async ({ id, hash }: { id: number; hash: string }) => {
      const res = await apiRequest("POST", `/api/crypto/${id}/submit-hash`, { txHash: hash });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crypto/deposits"] });
      setTxHash("");
      if (activeDeposit) {
        setActiveDeposit({ ...activeDeposit, status: "confirming", txHash });
      }
      toast({ title: "TX hash submitted", description: "Awaiting blockchain confirmation." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const simulateConfirmMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/crypto/${id}/simulate-confirm`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crypto/deposits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      refreshUser();
      setActiveDeposit(null);
      toast({ title: "Deposit confirmed", description: `Balance updated to $${data.newBalance}` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const effectiveAmount = isCustom ? parseFloat(customAmount) : selectedAmount;
  const selectedCurrencyData = currencies?.find(c => c.id === selectedCurrency);
  const cryptoAmount = selectedCurrencyData ? (effectiveAmount / selectedCurrencyData.rate).toFixed(8) : "0";

  const handleCreateDeposit = () => {
    if (!effectiveAmount || effectiveAmount < 1) {
      toast({ title: "Invalid amount", description: "Minimum $1", variant: "destructive" });
      return;
    }
    createDepositMutation.mutate({ currency: selectedCurrency, amount: effectiveAmount });
  };

  const handleCopyAddress = async (text: string, type: "address" | "amount") => {
    await navigator.clipboard.writeText(text);
    if (type === "address") {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } else {
      setCopiedAmount(true);
      setTimeout(() => setCopiedAmount(false), 2000);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="text-xs gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
      case "confirming":
        return <Badge className="text-xs gap-1 bg-yellow-500/10 text-yellow-500 border-yellow-500/20"><Loader2 className="w-3 h-3 animate-spin" />Confirming</Badge>;
      case "completed":
        return <Badge className="text-xs gap-1 bg-green-500/10 text-green-500 border-green-500/20"><CheckCircle2 className="w-3 h-3" />Completed</Badge>;
      case "expired":
        return <Badge variant="destructive" className="text-xs gap-1"><AlertCircle className="w-3 h-3" />Expired</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Add Funds</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Deposit crypto to top up your balance</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            {/* Current Balance */}
            <Card className="border-border bg-primary/5 border-primary/20">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Current Balance</p>
                  <p className="text-3xl font-bold text-primary" data-testid="text-current-balance">${user?.balance || "0.00"}</p>
                </div>
              </CardContent>
            </Card>

            {/* Active Deposit Flow */}
            {activeDeposit && activeDeposit.status !== "completed" && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Zap className="w-4 h-4 text-primary" />
                    Active Deposit — ${activeDeposit.amount} via {activeDeposit.currency.replace("_", " ")}
                    {statusBadge(activeDeposit.status)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {activeDeposit.status === "pending" && (
                    <>
                      <div className="bg-background rounded-lg border border-border p-4 space-y-3">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Send exactly</p>
                          <div className="flex items-center gap-2">
                            <code className="text-lg font-bold font-mono text-foreground">{activeDeposit.cryptoAmount} {activeDeposit.currency.replace("_", " ")}</code>
                            <button
                              onClick={() => handleCopyAddress(activeDeposit.cryptoAmount, "amount")}
                              className="p-1 rounded hover:bg-muted transition-colors"
                              data-testid="button-copy-amount"
                            >
                              {copiedAmount ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">To this wallet address</p>
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono text-foreground bg-muted px-2 py-1.5 rounded break-all flex-1">{activeDeposit.walletAddress}</code>
                            <button
                              onClick={() => handleCopyAddress(activeDeposit.walletAddress, "address")}
                              className="p-1.5 rounded hover:bg-muted transition-colors shrink-0"
                              data-testid="button-copy-address"
                            >
                              {copiedAddress ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-yellow-500">Send on the correct network. Wrong network = lost funds.</p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold">After sending, paste your Transaction Hash:</p>
                        <div className="flex gap-2">
                          <Input
                            placeholder="0x... or TxID"
                            value={txHash}
                            onChange={e => setTxHash(e.target.value)}
                            className="font-mono text-xs"
                            data-testid="input-tx-hash"
                          />
                          <Button
                            size="sm"
                            onClick={() => submitHashMutation.mutate({ id: activeDeposit.id, hash: txHash })}
                            disabled={!txHash.trim() || submitHashMutation.isPending}
                            data-testid="button-submit-hash"
                          >
                            <Send className="w-3.5 h-3.5 mr-1" />
                            {submitHashMutation.isPending ? "..." : "Submit"}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}

                  {activeDeposit.status === "confirming" && (
                    <div className="space-y-3">
                      <div className="bg-background rounded-lg border border-border p-4">
                        <div className="flex items-center gap-3">
                          <Loader2 className="w-5 h-5 animate-spin text-yellow-500" />
                          <div>
                            <p className="text-sm font-medium">Awaiting blockchain confirmation...</p>
                            <p className="text-xs text-muted-foreground mt-0.5">TX: <code className="font-mono">{activeDeposit.txHash}</code></p>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full border-green-500/30 text-green-500 hover:bg-green-500/10"
                        onClick={() => simulateConfirmMutation.mutate(activeDeposit.id)}
                        disabled={simulateConfirmMutation.isPending}
                        data-testid="button-simulate-confirm"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                        {simulateConfirmMutation.isPending ? "Confirming..." : "Simulate Confirmation (Demo)"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* New Deposit Form */}
            {(!activeDeposit || activeDeposit.status === "completed") && (
              <>
                {/* Currency Selection */}
                <Card className="border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Select Cryptocurrency</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {currLoading ? (
                      <div className="grid grid-cols-3 gap-2">
                        {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-16" />)}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {currencies?.map(c => (
                          <button
                            key={c.id}
                            onClick={() => setSelectedCurrency(c.id)}
                            className={`relative p-3 rounded-lg border text-left transition-all ${
                              selectedCurrency === c.id
                                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                : "border-border hover:border-primary/40"
                            }`}
                            data-testid={`button-crypto-${c.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`w-8 h-8 rounded-full bg-gradient-to-br ${CRYPTO_COLORS[c.id] || "from-gray-400 to-gray-500"} flex items-center justify-center text-white text-sm font-bold`}>
                                {CRYPTO_ICONS[c.id] || "?"}
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate">{c.name}</p>
                                <p className="text-xs text-muted-foreground">{c.network}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Amount Selection */}
                <Card className="border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Deposit Amount (USD)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
                      {PRESET_AMOUNTS.map(amt => (
                        <button
                          key={amt}
                          onClick={() => { setSelectedAmount(amt); setIsCustom(false); setCustomAmount(""); }}
                          className={`py-2.5 rounded-lg border text-sm font-semibold transition-all
                            ${!isCustom && selectedAmount === amt
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:border-primary/40"}`}
                          data-testid={`button-amount-${amt}`}
                        >
                          ${amt}
                        </button>
                      ))}
                    </div>

                    <div className="relative">
                      <div
                        className={`flex items-center gap-2 border rounded-lg px-3 h-9 transition-all
                          ${isCustom ? "border-primary ring-1 ring-primary/20" : "border-border"}`}
                        onClick={() => setIsCustom(true)}
                      >
                        <span className="text-sm text-muted-foreground">$</span>
                        <Input
                          type="number"
                          placeholder="Custom amount"
                          value={customAmount}
                          onChange={e => setCustomAmount(e.target.value)}
                          onFocus={() => setIsCustom(true)}
                          className="border-0 h-full p-0 focus-visible:ring-0 text-sm"
                          min="1"
                          data-testid="input-custom-amount"
                        />
                      </div>
                    </div>

                    {/* Crypto conversion preview */}
                    {effectiveAmount > 0 && selectedCurrencyData && (
                      <div className="mt-3 p-2.5 rounded-lg bg-muted/50 border border-border">
                        <p className="text-xs text-muted-foreground">
                          You'll send approximately{" "}
                          <span className="font-mono font-semibold text-foreground">{cryptoAmount} {selectedCurrencyData.name}</span>
                          {" "}(rate: 1 {selectedCurrencyData.name} ≈ ${selectedCurrencyData.rate.toLocaleString()})
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Create Deposit Button */}
                <Button
                  size="lg"
                  className="w-full"
                  onClick={handleCreateDeposit}
                  disabled={createDepositMutation.isPending || !effectiveAmount || isNaN(effectiveAmount) || effectiveAmount < 1}
                  data-testid="button-create-deposit"
                >
                  {createDepositMutation.isPending
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</>
                    : <>
                        <Zap className="w-4 h-4 mr-2" />
                        Deposit ${isCustom ? (parseFloat(customAmount) || 0).toFixed(2) : selectedAmount.toFixed(2)} via {currencies?.find(c => c.id === selectedCurrency)?.name || selectedCurrency}
                      </>
                  }
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Minimum deposit $1.00. Deposits are credited after blockchain confirmation.
                </p>
              </>
            )}

            {/* Recent Deposits */}
            {deposits && deposits.length > 0 && (
              <Card className="border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Recent Deposits</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {deposits.slice(0, 5).map((dep: any) => (
                      <div
                        key={dep.id}
                        className="flex items-center gap-3 py-2.5 border-b border-border last:border-0 cursor-pointer hover:bg-muted/30 rounded-md px-1.5 -mx-1.5 transition-colors"
                        onClick={() => {
                          if (dep.status !== "completed" && dep.status !== "expired") {
                            setActiveDeposit(dep);
                          }
                        }}
                        data-testid={`row-deposit-${dep.id}`}
                      >
                        <span className={`w-8 h-8 rounded-full bg-gradient-to-br ${CRYPTO_COLORS[dep.currency] || "from-gray-400 to-gray-500"} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {CRYPTO_ICONS[dep.currency] || "?"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">
                            ${dep.amount} via {dep.currency.replace("_", " ")}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatDate(dep.createdAt)}</p>
                        </div>
                        {statusBadge(dep.status)}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Transaction History Sidebar */}
          <div>
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Recent Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                {txLoading ? (
                  <div className="space-y-3">
                    {[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}
                  </div>
                ) : !transactions || transactions.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No transactions yet</p>
                ) : (
                  <div className="space-y-2">
                    {transactions.slice(0, 10).map((tx: any) => (
                      <div key={tx.id} className="flex items-center gap-2.5 py-2 border-b border-border last:border-0" data-testid={`row-tx-${tx.id}`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          tx.type === "deposit" ? "bg-green-100 dark:bg-green-900/30" :
                          tx.type === "refund" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-red-100 dark:bg-red-900/30"
                        }`}>
                          {tx.type === "deposit" || tx.type === "refund"
                            ? <ArrowDownRight className={`w-3.5 h-3.5 ${tx.type === "deposit" ? "text-green-600" : "text-blue-600"}`} />
                            : <ArrowUpRight className="w-3.5 h-3.5 text-red-600" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{tx.description || tx.type}</p>
                          <p className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                        </div>
                        <span className={`text-xs font-bold shrink-0 ${
                          tx.amount.startsWith("-") ? "text-red-500" : "text-green-500"
                        }`}>
                          {tx.amount.startsWith("-") ? "" : "+"}{tx.amount.startsWith("-") ? tx.amount : `$${tx.amount}`}
                        </span>
                      </div>
                    ))}
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
