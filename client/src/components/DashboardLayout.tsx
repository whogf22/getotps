import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  ShoppingCart,
  Phone,
  History,
  CreditCard,
  BookOpen,
  User,
  LogOut,
  Moon,
  Sun,
  Menu,
  X,
  ChevronLeft,
  ShieldCheck,
  Plus,
  Bell,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/buy", label: "Buy Number", icon: ShoppingCart },
  { href: "/active", label: "Active Numbers", icon: Phone },
  { href: "/history", label: "History", icon: History },
  { href: "/funds", label: "Add Funds", icon: CreditCard },
  { href: "/changelog", label: "Changelog", icon: Bell },
  { href: "/support", label: "Support", icon: ShieldCheck },
  { href: "/faq", label: "FAQ", icon: BookOpen },
  { href: "/profile", label: "Account", icon: User },
];

const adminNavItems = [
  ...navItems.slice(0, 5),
  { href: "/api-docs", label: "API Docs", icon: BookOpen },
  { href: "/profile", label: "Account", icon: User },
];

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [location] = useLocation();
  const { data: changelogItems } = useQuery<any[]>({
    queryKey: ["/api/changelog"],
    enabled: !!user,
    refetchInterval: 60000,
  });
  const unreadCount = (changelogItems || []).filter((c) => !c.is_read).length;

  const handleLogout = async () => {
    await logout();
    window.location.hash = "/";
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
        <Logo showText={!collapsed} size={28} />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-collapse-sidebar"
        >
          <ChevronLeft className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Balance */}
      <div className={`mx-3 my-3 p-3 rounded-lg bg-primary/10 border border-primary/20 ${collapsed ? "text-center" : ""}`}>
        {collapsed ? (
          <span className="text-primary font-bold text-sm">${user?.balance || "0.00"}</span>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Balance</p>
            <p className="text-lg font-bold text-primary" data-testid="text-balance">${user?.balance || "0.00"}</p>
          </div>
        )}
      </div>

      {/* Nav Items */}
      <nav className="flex-1 px-2 py-2 space-y-0.5" data-testid="nav-sidebar">
        {(user?.role === "admin" ? adminNavItems : navItems).map(({ href, label, icon: Icon }) => {
          const active = location === href;
          return (
            <Link key={href} href={href}>
              <a
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer
                  ${active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }
                  ${collapsed ? "justify-center" : ""}
                `}
                onClick={() => setMobileOpen(false)}
                data-testid={`nav-link-${href.replace("/", "")}`}
                title={collapsed ? label : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{label}</span>}
                {!collapsed && href === "/changelog" && unreadCount > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
                    {unreadCount}
                  </Badge>
                )}
              </a>
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="p-3 border-t border-sidebar-border space-y-1">
        {user?.role === "admin" && (
          <Link href="/admin">
            <a
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 w-full transition-colors ${collapsed ? "justify-center" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              {!collapsed && <span>Admin Panel</span>}
            </a>
          </Link>
        )}
        <button
          onClick={toggleTheme}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent w-full transition-colors ${collapsed ? "justify-center" : ""}`}
          data-testid="button-toggle-theme"
        >
          {theme === "dark" ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
          {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
        </button>
        <button
          onClick={handleLogout}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 w-full transition-colors ${collapsed ? "justify-center" : ""}`}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200 shrink-0 ${collapsed ? "w-16" : "w-56"}`}
      >
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 bg-sidebar border-r border-sidebar-border flex flex-col z-10">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between h-14 px-4 border-b border-border bg-background shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-1.5 rounded-lg hover:bg-accent transition-colors"
              onClick={() => setMobileOpen(!mobileOpen)}
              data-testid="button-mobile-menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-muted-foreground hidden sm:block">
              Welcome back, <span className="text-foreground">{user?.username}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <span className="text-xs text-muted-foreground hidden sm:block">Balance</span>
              <span className="text-sm font-bold text-primary" data-testid="text-header-balance">${user?.balance || "0.00"}</span>
            </div>
            <Link href="/funds">
              <a>
                <Button size="sm" variant="outline" className="text-xs h-8" data-testid="button-add-funds">
                  <Plus className="w-3 h-3 mr-1" />
                  <span className="hidden sm:inline">Add Funds</span>
                  <span className="sm:hidden">Fund</span>
                </Button>
              </a>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
