import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import BuyNumber from "@/pages/BuyNumber";
import ActiveNumbers from "@/pages/ActiveNumbers";
import History from "@/pages/History";
import AddFunds from "@/pages/AddFunds";
import ApiDocs from "@/pages/ApiDocs";
import Profile from "@/pages/Profile";
import Terms from "@/pages/Terms";
import Privacy from "@/pages/Privacy";
import AdminOverview from "@/pages/admin/AdminOverview";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminDeposits from "@/pages/admin/AdminDeposits";
import AdminServices from "@/pages/admin/AdminServices";
import { Skeleton } from "@/components/ui/skeleton";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  if (!user) {
    window.location.hash = "/login";
    return null;
  }

  return <Component />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  if (!user) {
    window.location.hash = "/login";
    return null;
  }

  if (user.role !== "admin") {
    window.location.hash = "/dashboard";
    return null;
  }

  return <Component />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/buy" component={() => <ProtectedRoute component={BuyNumber} />} />
      <Route path="/active" component={() => <ProtectedRoute component={ActiveNumbers} />} />
      <Route path="/history" component={() => <ProtectedRoute component={History} />} />
      <Route path="/funds" component={() => <ProtectedRoute component={AddFunds} />} />
      <Route path="/api-docs" component={() => <ProtectedRoute component={ApiDocs} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={Profile} />} />
      {/* Admin routes */}
      <Route path="/admin" component={() => <AdminRoute component={AdminOverview} />} />
      <Route path="/admin/users" component={() => <AdminRoute component={AdminUsers} />} />
      <Route path="/admin/deposits" component={() => <AdminRoute component={AdminDeposits} />} />
      <Route path="/admin/services" component={() => <AdminRoute component={AdminServices} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
