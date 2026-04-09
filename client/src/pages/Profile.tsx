import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { User, Key, Lock, Copy, Check, RefreshCw, Eye, EyeOff, DollarSign } from "lucide-react";

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copiedKey, setCopiedKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  const generateKeyMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", "/api/profile/generate-api-key", {}); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      refreshUser();
      toast({ title: "New API key generated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", "/api/profile/change-password", { currentPassword, newPassword }); return res.json(); },
    onSuccess: () => {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      toast({ title: "Password updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleCopyKey = async () => {
    if (user?.apiKey) {
      await navigator.clipboard.writeText(user.apiKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleChangePassword = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      return toast({ title: "Fill in all fields", variant: "destructive" });
    }
    if (newPassword !== confirmPassword) {
      return toast({ title: "Passwords don't match", variant: "destructive" });
    }
    if (newPassword.length < 8) {
      return toast({ title: "Password must be at least 8 characters", variant: "destructive" });
    }
    changePasswordMutation.mutate();
  };

  const maskedKey = user?.apiKey
    ? showKey ? user.apiKey : `${user.apiKey.slice(0, 8)}${"•".repeat(24)}${user.apiKey.slice(-4)}`
    : "No API key generated";

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-2xl">
        <div>
          <h1 className="text-xl font-bold">Account</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your account settings</p>
        </div>

        {/* Account Info */}
        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl font-bold">
                {user?.username?.charAt(0).toUpperCase() || "U"}
              </div>
              <div>
                <p className="font-semibold text-lg">{user?.username}</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-xs text-muted-foreground mb-0.5">Balance</p>
                <p className="text-lg font-bold text-primary">${user?.balance || "0.00"}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 border border-border">
                <p className="text-xs text-muted-foreground mb-0.5">Account Type</p>
                <Badge variant={user?.role === "admin" ? "default" : "secondary"} className="mt-0.5">
                  {user?.role === "admin" ? "Admin" : "Standard"}
                </Badge>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 border border-border">
                <p className="text-xs text-muted-foreground mb-0.5">Username</p>
                <p className="text-sm font-medium">{user?.username}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* API Key — admin only */}
        {user?.role === "admin" && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Key className="w-4 h-4 text-primary" />
                API Key
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Use this key to authenticate API requests.</p>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border">
                <code className="flex-1 font-mono text-xs truncate">{maskedKey}</code>
                <button onClick={() => setShowKey(!showKey)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0">
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {user?.apiKey && (
                  <button onClick={handleCopyKey} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => generateKeyMutation.mutate()} disabled={generateKeyMutation.isPending}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${generateKeyMutation.isPending ? "animate-spin" : ""}`} />
                {user?.apiKey ? "Regenerate" : "Generate"} API Key
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Change Password */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              Change Password
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Current Password</Label>
              <div className="relative">
                <Input
                  type={showCurrentPw ? "text" : "password"}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="h-9 pr-10 text-sm"
                  placeholder="Current password"
                />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowCurrentPw(!showCurrentPw)}>
                  {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">New Password</Label>
              <div className="relative">
                <Input
                  type={showNewPw ? "text" : "password"}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="h-9 pr-10 text-sm"
                  placeholder="Min. 8 characters"
                />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowNewPw(!showNewPw)}>
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Confirm New Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="h-9 text-sm"
                placeholder="Repeat new password"
              />
            </div>
            <Button onClick={handleChangePassword} disabled={changePasswordMutation.isPending} size="sm">
              {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
