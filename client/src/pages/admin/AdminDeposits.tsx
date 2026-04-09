import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Check, X, ExternalLink, Copy } from "lucide-react";

interface Deposit {
  id: number;
  userId: number;
  currency: string;
  amount: string;
  cryptoAmount: string | null;
  walletAddress: string;
  txHash: string | null;
  status: string;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    confirming: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    expired: "bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.expired}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function AdminDeposits() {
  const [tab, setTab] = useState("pending");
  const [confirmDialog, setConfirmDialog] = useState<Deposit | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: allDeposits, isLoading } = useQuery<Deposit[]>({
    queryKey: ["/api/admin/crypto/all"],
    refetchInterval: 10000,
  });

  const confirmMutation = useMutation({
    mutationFn: async (depositId: number) => {
      const res = await apiRequest("POST", `/api/admin/crypto/${depositId}/confirm`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crypto/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setConfirmDialog(null);
      toast({ title: "Deposit confirmed", description: "User balance has been credited." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const deposits = allDeposits || [];

  const filteredDeposits = deposits.filter(d => {
    if (tab === "pending") return d.status === "pending" || d.status === "confirming";
    if (tab === "completed") return d.status === "completed";
    return true;
  });

  return (
    <AdminLayout title="Crypto Deposits" description="Review and approve user deposits">
      <div className="space-y-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending" className="text-xs">
              Pending / Confirming
              {deposits.filter(d => d.status === "pending" || d.status === "confirming").length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold">
                  {deposits.filter(d => d.status === "pending" || d.status === "confirming").length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed" className="text-xs">Completed</TabsTrigger>
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            <Card className="border-border">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">ID</TableHead>
                      <TableHead className="w-20">User</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="hidden lg:table-cell">Tx Hash</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Date</TableHead>
                      <TableHead className="w-24">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 8 }).map((_, j) => (
                            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : filteredDeposits.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          No deposits found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredDeposits.map(dep => (
                        <TableRow key={dep.id}>
                          <TableCell className="font-mono text-xs">{dep.id}</TableCell>
                          <TableCell className="font-mono text-xs">#{dep.userId}</TableCell>
                          <TableCell className="font-medium text-sm">{dep.currency}</TableCell>
                          <TableCell className="text-right">
                            <div>
                              <p className="font-mono font-medium">${dep.amount}</p>
                              {dep.cryptoAmount && (
                                <p className="text-xs text-muted-foreground">{dep.cryptoAmount} {dep.currency.split("_")[0]}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {dep.txHash ? (
                              <div className="flex items-center gap-1">
                                <code className="text-xs bg-muted px-1.5 py-0.5 rounded max-w-[120px] truncate block">
                                  {dep.txHash}
                                </code>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyToClipboard(dep.txHash!)}>
                                  <Copy className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell><StatusBadge status={dep.status} /></TableCell>
                          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                            {new Date(dep.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {(dep.status === "pending" || dep.status === "confirming") && (
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setConfirmDialog(dep)}
                              >
                                <Check className="w-3 h-3 mr-1" />
                                Approve
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Confirm Dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Deposit</DialogTitle>
          </DialogHeader>
          {confirmDialog && (
            <div className="space-y-3 text-sm">
              <p>
                Are you sure you want to approve this deposit and credit
                <span className="font-bold text-primary"> ${confirmDialog.amount}</span> to
                user <span className="font-bold">#{confirmDialog.userId}</span>?
              </p>
              <div className="bg-muted p-3 rounded-lg space-y-1">
                <p><span className="text-muted-foreground">Currency:</span> {confirmDialog.currency}</p>
                <p><span className="text-muted-foreground">Crypto Amount:</span> {confirmDialog.cryptoAmount}</p>
                {confirmDialog.txHash && (
                  <p><span className="text-muted-foreground">Tx Hash:</span> <code className="text-xs break-all">{confirmDialog.txHash}</code></p>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => confirmDialog && confirmMutation.mutate(confirmDialog.id)}
              disabled={confirmMutation.isPending}
            >
              {confirmMutation.isPending ? "Approving..." : "Approve & Credit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
