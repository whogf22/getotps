import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  Copy,
  Check,
  Clock,
  CheckCircle2,
  AlertCircle,
  Zap,
  Send,
  Loader2,
  ArrowRight,
  ShoppingCart,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
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
  BTC: "₿", ETH: "Ξ", USDT_TRC20: "₮", USDT_ERC20: "₮", USDC: "$", LTC: "Ł",
};

const CRYPTO_COLORS: Record<string, string> = {
  BTC: "from-orange-500 to-amber-500",
  ETH: "from-indigo-500 to-purple-500",
  USDT_TRC20: "from-emerald-500 to-green-500",
  USDT_ERC20: "from-emerald-500 to-green-500",
  USDC: "from-blue-500 to-cyan-500",
  LTC: "from-slate-400 to-slate-500",
};

const RECOMMENDED_CURRENCY = "USDT_TRC20";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-muted hover:bg-muted/80 transition-colors shrink-0"
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      {label || (copied ? "Copied" : "Copy")}
    </button>
  );
}

function DepositStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          <Clock className="w-3 h-3" /> Awaiting payment
        </span>
      );
    case "confirming":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          <Loader2 className="w-3 h-3 animate-spin" /> Confirming
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle2 className="w-3 h-3" /> Completed
        </span>
      );
    case "expired":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
          <AlertCircle className="w-3 h-3" /> Expired
        </span>
      );
    default:
      return <span className="text-xs text-muted-foreground">{status}</span>;
  }
}

export default function AddFunds() {
  const [selectedCurrency, setSelectedCurrency] = useState<string>(RECOMMENDED_CURRENCY);
  const [selectedAmount, setSelectedAmount] = useState<number>(10);
  const [customAmount, setCustomAmount] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [activeDeposit, setActiveDeposit] = useState<any>(null);
  const [showOtherCurrencies, setShowOtherCurrencies] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: currencies, isLoading: currLoading } = useQuery<CryptoCurrency[]>({
    queryKey: ["/api/crypto/currencies"],
  });

  const { data: circleWalletData, refetch: refetchCircleWallet } = useQuery<{
    balanceUsdc: number;
    walletAddress?: string;
    blockchain?: string;
  }>({
    queryKey: ["/api/wallet/balance"],
    retry: false,
  });

  const createWalletMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/wallet/create", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallet/balance"] });
      toast({ title: "Wallet ready", description: "Your USDC deposit address has been created." });
    },
    onError: (err: any) => {
      toast({ title: "Wallet error", description: err.message, variant: "destructive" });
    },
  });

  const { data: deposits } = useQuery<any[]>({
    queryKey: ["/api/crypto/deposits"],
    refetchInterval: 5000, // Poll frequently so auto-confirmed deposits update quickly
  });

  // Sync activeDeposit state with backend polling data
  useEffect(() => {
    if (!activeDeposit || !deposits) return;
    const updated = deposits.find((d: any) => d.id === activeDeposit.id);
    if (updated && updated.status !== activeDeposit.status) {
      setActiveDeposit(updated);
      if (updated.status === "completed") {
        refreshUser();
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }
    }
  }, [deposits, activeDeposit]);

  const { data: transactions } = useQuery<any[]>({
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
      toast({ title: "Deposit created", description: "Send the exact amount shown below." });
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
      toast({ title: "Payment submitted", description: "We're verifying your transaction." });
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
      toast({ title: "Invalid amount", description: "Minimum deposit is $1.00", variant: "destructive" });
      return;
    }
    createDepositMutation.mutate({ currency: selectedCurrency, amount: effectiveAmount });
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // Separate recommended from other currencies
  const recommendedCurrency = currencies?.find(c => c.id === RECOMMENDED_CURRENCY);
  const otherCurrencies = currencies?.filter(c => c.id !== RECOMMENDED_CURRENCY) || [];

  // Recent completed deposits count
  const completedDeposits = deposits?.filter(d => d.status === "completed").length || 0;
  const pendingDeposits = deposits?.filter(d => d.status === "pending" || d.status === "confirming") || [];

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold">Add Funds</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Deposit crypto to top up your balance</p>
        </div>

        {/* Current Balance */}
        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Current Balance</p>
                <p className="text-2xl font-bold text-primary">${user?.balance || "0.00"}</p>
              </div>
            </div>
            {parseFloat(user?.balance || "0") >= 0.15 && (
              <Link href="/buy">
                <a>
                  <Button variant="outline" size="sm" className="text-xs">
                    <ShoppingCart className="w-3 h-3 mr-1.5" />
                    Buy Number
                  </Button>
                </a>
              </Link>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">USDC Wallet Deposit (Circle)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!circleWalletData?.walletAddress ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <p className="text-xs text-muted-foreground">
                  Create your dedicated USDC deposit wallet to pay for OTP purchases directly.
                </p>
                <Button
                  size="sm"
                  onClick={() => createWalletMutation.mutate()}
                  disabled={createWalletMutation.isPending}
                >
                  {createWalletMutation.isPending ? "Creating..." : "Create Wallet"}
                </Button>
              </div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  Network: <span className="font-medium text-foreground">{circleWalletData.blockchain || "Configured network"}</span>
                </div>
                <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg p-2">
                  <code className="text-xs font-mono break-all flex-1">{circleWalletData.walletAddress}</code>
                  <CopyButton text={circleWalletData.walletAddress} />
                </div>
                <div className="flex items-center gap-3">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(circleWalletData.walletAddress)}`}
                    alt="Deposit wallet QR"
                    className="w-24 h-24 rounded border border-border"
                  />
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">Send ONLY USDC on this network.</p>
                    <p>Wrong tokens or wrong networks may result in permanent loss of funds.</p>
                    <p className="mt-2">
                      Balance: <span className="font-semibold text-foreground">{(circleWalletData.balanceUsdc || 0).toFixed(2)} USDC</span>
                    </p>
                    <Button variant="ghost" size="sm" className="px-0 text-xs h-6" onClick={() => refetchCircleWallet()}>
                      Refresh wallet balance
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Resume pending deposit if exists */}
        {!activeDeposit && pendingDeposits.length > 0 && (
          <Card className="border-yellow-500/30">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">You have a pending deposit</p>
                  <p className="text-xs text-muted-foreground">
                    ${pendingDeposits[0].amount} via {pendingDeposits[0].currency.replace("_", " ")}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setActiveDeposit(pendingDeposits[0])}>
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active Deposit Flow */}
        {activeDeposit && activeDeposit.status !== "completed" && (
          <Card className="border-primary/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Deposit ${activeDeposit.amount} via {activeDeposit.currency.replace("_", " ")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeDeposit.status === "pending" && (() => {
                const isAutoConfirm = activeDeposit.currency === "USDT_TRC20" && activeDeposit.uniqueAmount;
                const displayAmount = isAutoConfirm ? activeDeposit.uniqueAmount : activeDeposit.cryptoAmount;
                const displayCurrency = activeDeposit.currency.split("_")[0];

                return (
                  <>
                    {/* Payment instructions */}
                    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
                      {/* Amount to send */}
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5 font-medium">
                          Send <span className="text-foreground font-semibold">exactly</span> this amount
                        </p>
                        <div className="flex items-center justify-between bg-background rounded-lg border border-border p-3">
                          <span className="text-lg font-bold font-mono">{displayAmount} {displayCurrency}</span>
                          <CopyButton text={displayAmount} label="Copy" />
                        </div>
                        {isAutoConfirm && (
                          <p className="text-xs text-muted-foreground mt-1.5">
                            The exact amount matters — it's used to identify your payment automatically.
                          </p>
                        )}
                      </div>

                      {/* Wallet address */}
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5 font-medium">To this wallet address</p>
                        <div className="flex items-center gap-2 bg-background rounded-lg border border-border p-3">
                          <code className="text-xs font-mono break-all flex-1 select-all">{activeDeposit.walletAddress}</code>
                          <CopyButton text={activeDeposit.walletAddress} />
                        </div>
                      </div>

                      {/* Network warning */}
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                        <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400">
                            Send only on the {activeDeposit.currency === "USDT_TRC20" ? "TRC20" : activeDeposit.currency === "USDT_ERC20" ? "ERC20" : activeDeposit.currency} network
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">Sending on the wrong network may result in lost funds.</p>
                        </div>
                      </div>
                    </div>

                    {/* Auto-confirm message for USDT TRC20 */}
                    {isAutoConfirm ? (
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-medium">Your balance will update automatically</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            We monitor the blockchain for your payment. This usually takes 1-3 minutes after you send.
                          </p>
                        </div>
                      </div>
                    ) : (
                      /* Manual tx hash for non-USDT currencies */
                      <div>
                        <p className="text-xs font-medium mb-2">After sending, paste your transaction ID:</p>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Transaction ID or hash"
                            value={txHash}
                            onChange={e => setTxHash(e.target.value)}
                            className="font-mono text-xs"
                          />
                          <Button
                            size="sm"
                            onClick={() => submitHashMutation.mutate({ id: activeDeposit.id, hash: txHash })}
                            disabled={!txHash.trim() || submitHashMutation.isPending}
                          >
                            <Send className="w-3.5 h-3.5 mr-1.5" />
                            {submitHashMutation.isPending ? "..." : "Submit"}
                          </Button>
                        </div>
                      </div>
                    )}

                    <Separator />
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-muted-foreground">Changed your mind?</p>
                      <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setActiveDeposit(null)}>
                        Cancel & Start Over
                      </Button>
                    </div>
                  </>
                );
              })()}

              {(activeDeposit.status === "confirming" || (activeDeposit.status === "pending" && false)) && (
                <div className="text-center py-4 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto">
                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Verifying your payment...</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This usually takes a few minutes. Your balance will update automatically.
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setActiveDeposit(null)}>
                    Close & Check Later
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Deposit confirmed success */}
        {activeDeposit && activeDeposit.status === "completed" && (
          <Card className="border-green-500/30 bg-green-500/[0.03]">
            <CardContent className="p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-sm font-bold">Deposit confirmed!</p>
                <p className="text-xs text-muted-foreground mt-1">${activeDeposit.amount} has been added to your balance.</p>
              </div>
              <div className="flex gap-2 justify-center">
                <Link href="/buy">
                  <a><Button size="sm" className="text-xs"><ShoppingCart className="w-3 h-3 mr-1.5" />Buy a Number</Button></a>
                </Link>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setActiveDeposit(null)}>
                  Make Another Deposit
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* New Deposit Form — only show when no active deposit */}
        {(!activeDeposit || activeDeposit.status === "completed") && !activeDeposit?.status?.match(/pending|confirming/) && (
          <div className="space-y-4">
            {/* Amount Selection */}
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">How much would you like to deposit?</CardTitle>
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
                    >
                      ${amt}
                    </button>
                  ))}
                </div>

                <div
                  className={`flex items-center gap-2 border rounded-lg px-3 h-10 transition-all cursor-text
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
                  />
                </div>
              </CardContent>
            </Card>

            {/* Currency Selection */}
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Payment method</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Recommended */}
                {recommendedCurrency && (
                  <button
                    onClick={() => { setSelectedCurrency(RECOMMENDED_CURRENCY); setShowOtherCurrencies(false); }}
                    className={`flex items-center gap-3 w-full p-3 rounded-lg border text-left transition-all
                      ${selectedCurrency === RECOMMENDED_CURRENCY
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border hover:border-primary/40"
                      }`}
                  >
                    <span className={`w-10 h-10 rounded-full bg-gradient-to-br ${CRYPTO_COLORS[RECOMMENDED_CURRENCY]} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                      {CRYPTO_ICONS[RECOMMENDED_CURRENCY]}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{recommendedCurrency.name}</p>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Recommended</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{recommendedCurrency.network} network · Low fees · Fast</p>
                    </div>
                    {selectedCurrency === RECOMMENDED_CURRENCY && (
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                    )}
                  </button>
                )}

                {/* Other currencies toggle */}
                <button
                  onClick={() => setShowOtherCurrencies(!showOtherCurrencies)}
                  className="flex items-center justify-center gap-1.5 w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showOtherCurrencies ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showOtherCurrencies ? "Hide" : "Show"} other payment options
                </button>

                {showOtherCurrencies && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {otherCurrencies.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCurrency(c.id)}
                        className={`flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all
                          ${selectedCurrency === c.id
                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                            : "border-border hover:border-primary/40"
                          }`}
                      >
                        <span className={`w-8 h-8 rounded-full bg-gradient-to-br ${CRYPTO_COLORS[c.id] || "from-gray-400 to-gray-500"} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {CRYPTO_ICONS[c.id] || "?"}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.network}</p>
                        </div>
                        {selectedCurrency === c.id && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary ml-auto shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Conversion preview */}
                {effectiveAmount > 0 && selectedCurrencyData && (
                  <div className="p-3 rounded-lg bg-muted/50 border border-border">
                    <p className="text-xs text-muted-foreground">
                      {selectedCurrency === "USDT_TRC20" ? (
                        <>You'll send approximately <span className="font-mono font-semibold text-foreground">{effectiveAmount.toFixed(2)} USDT</span> (exact amount shown after you click deposit)</>
                      ) : (
                        <>You'll send approximately <span className="font-mono font-semibold text-foreground">{cryptoAmount} {selectedCurrencyData.name}</span></>
                      )}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Create Deposit Button */}
            <Button
              size="lg"
              className="w-full h-12"
              onClick={handleCreateDeposit}
              disabled={createDepositMutation.isPending || !effectiveAmount || isNaN(effectiveAmount) || effectiveAmount < 1}
            >
              {createDepositMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating deposit...</>
                : <>
                    Deposit ${isCustom ? (parseFloat(customAmount) || 0).toFixed(2) : selectedAmount.toFixed(2)}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
              }
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Minimum $1.00 · Balance is credited after confirmation
            </p>
          </div>
        )}

        {/* Deposit History — collapsible */}
        {deposits && deposits.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center justify-between w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Deposit History ({deposits.length})</span>
              {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showHistory && (
              <Card className="border-border mt-2">
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {deposits.slice(0, 10).map((dep: any) => (
                      <div
                        key={dep.id}
                        className="flex items-center gap-3 p-3 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => {
                          if (dep.status === "pending" || dep.status === "confirming") {
                            setActiveDeposit(dep);
                          }
                        }}
                      >
                        <span className={`w-8 h-8 rounded-full bg-gradient-to-br ${CRYPTO_COLORS[dep.currency] || "from-gray-400 to-gray-500"} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {CRYPTO_ICONS[dep.currency] || "?"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">${dep.amount}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(dep.createdAt)}</p>
                        </div>
                        <DepositStatusBadge status={dep.status} />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
