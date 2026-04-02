import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Moon, Sun, CheckCircle, Zap, Shield, Globe, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";

const POPULAR_SERVICES = [
  { name: "WhatsApp", icon: "📱", price: "0.50" },
  { name: "Google", icon: "🔍", price: "0.45" },
  { name: "Telegram", icon: "✈️", price: "0.35" },
  { name: "Facebook", icon: "👤", price: "0.40" },
  { name: "Instagram", icon: "📸", price: "0.45" },
  { name: "Twitter / X", icon: "🐦", price: "0.35" },
  { name: "TikTok", icon: "🎵", price: "0.40" },
  { name: "Discord", icon: "💬", price: "0.30" },
  { name: "Amazon", icon: "🛒", price: "0.55" },
  { name: "Uber", icon: "🚗", price: "0.60" },
  { name: "PayPal", icon: "💳", price: "0.70" },
  { name: "Coinbase", icon: "₿", price: "0.75" },
];

const FAQS = [
  {
    q: "What is GetOTPs?",
    a: "GetOTPs is a virtual phone number service that lets you receive SMS verification codes for 500+ apps and websites without using your personal phone number.",
  },
  {
    q: "How does it work?",
    a: "Create an account, add balance, select a service, and get a US phone number. Use that number to receive your OTP code, which appears in your dashboard instantly.",
  },
  {
    q: "How long do I have the number?",
    a: "Each number is rented for 20 minutes. If no SMS arrives in that time, you can cancel for a full refund.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit and debit cards via Stripe's secure checkout. All transactions are encrypted.",
  },
  {
    q: "Can I use the API?",
    a: "Yes! Every account gets an API key. You can integrate GetOTPs into your own projects using our REST API.",
  },
];

export default function Landing() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const { data: services } = useQuery<any[]>({
    queryKey: ["/api/services"],
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Logo size={28} />
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#services" onClick={e => { e.preventDefault(); document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">Services</a>

            <a href="#faq" onClick={e => { e.preventDefault(); document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-accent transition-colors" data-testid="button-theme-toggle">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {user ? (
              <Link href="/dashboard"><a><Button size="sm" data-testid="button-go-dashboard">Dashboard</Button></a></Link>
            ) : (
              <>
                <Link href="/login"><a><Button variant="ghost" size="sm" data-testid="button-login">Sign In</Button></a></Link>
                <Link href="/register"><a><Button size="sm" data-testid="button-register">Get Started</Button></a></Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-20 right-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-6xl mx-auto px-4 text-center relative">
          <Badge variant="secondary" className="mb-4 text-xs font-medium">
            🚀 500+ Services Supported
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5 leading-tight">
            Real US Numbers for<br />
            <span className="text-primary">Instant SMS Verification</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-8">
            Get disposable US phone numbers to verify any app or service. No personal data exposed. Instant delivery. From just $0.15.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register">
              <a>
                <Button size="lg" className="w-full sm:w-auto px-8" data-testid="button-hero-register">
                  Start Verifying — Free
                </Button>
              </a>
            </Link>
            <Link href="/register">
              <a>
                <Button size="lg" variant="outline" className="w-full sm:w-auto px-8" data-testid="button-hero-pricing">
                  View Services
                </Button>
              </a>
            </Link>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 py-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            {[
              { label: "Services Supported", value: "500+" },
              { label: "Uptime", value: "99.9%" },
              { label: "Delivery Speed", value: "Instant" },
              { label: "Starting From", value: "$0.15" },
            ].map(stat => (
              <div key={stat.label}>
                <p className="text-xl font-bold text-primary">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 max-w-6xl mx-auto px-4">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold mb-2">How It Works</h2>
          <p className="text-muted-foreground text-sm">Get your OTP in under 2 minutes</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { step: "1", icon: "👤", title: "Create Account", desc: "Register free. No credit card required to sign up." },
            { step: "2", icon: "💳", title: "Add Balance", desc: "Top up with as little as $5 via secure Stripe checkout." },
            { step: "3", icon: "📱", title: "Get Number", desc: "Choose a service, get a US number, receive your OTP code." },
          ].map(item => (
            <Card key={item.step} className="relative border-border">
              <CardContent className="p-6 text-center">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center mx-auto mb-3">
                  {item.step}
                </div>
                <div className="text-3xl mb-3">{item.icon}</div>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Popular Services */}
      <section id="services" className="py-16 bg-muted/20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold mb-2">Popular Services</h2>
            <p className="text-muted-foreground text-sm">Verify accounts across all major platforms</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {(services || POPULAR_SERVICES).slice(0, 12).map((svc: any, idx: number) => (
              <Card key={idx} className="border-border hover:border-primary/40 transition-all hover:shadow-sm cursor-pointer group">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">{svc.icon}</div>
                  <p className="text-xs font-medium truncate">{svc.name}</p>
                  <p className="text-xs text-primary font-semibold mt-1">${svc.price}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="text-center mt-6">
            <Link href="/register">
              <a><Button variant="outline" size="sm">See All 500+ Services</Button></a>
            </Link>
          </div>
        </div>
      </section>



      {/* Features */}
      <section className="py-16 bg-muted/20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: <Zap className="w-5 h-5 text-primary" />, title: "Instant Delivery", desc: "OTP codes appear in your dashboard seconds after being sent. No delays." },
              { icon: <Shield className="w-5 h-5 text-primary" />, title: "100% Anonymous", desc: "Your personal number stays private. Use disposable numbers for every verification." },
              { icon: <Globe className="w-5 h-5 text-primary" />, title: "REST API", desc: "Fully documented API with code examples. Integrate into your own workflows." },
            ].map(f => (
              <div key={f.title} className="flex gap-4">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">{f.icon}</div>
                <div>
                  <h3 className="font-semibold mb-1 text-sm">{f.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 max-w-3xl mx-auto px-4">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold mb-2">Frequently Asked Questions</h2>
        </div>
        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <Card key={i} className="border-border">
              <CardContent className="p-0">
                <button
                  className="flex items-center justify-between w-full p-4 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  data-testid={`button-faq-${i}`}
                >
                  <span className="font-medium text-sm">{faq.q}</span>
                  {openFaq === i ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4 text-sm text-muted-foreground">{faq.a}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary/5 border-y border-border">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold mb-3">Ready to Get Started?</h2>
          <p className="text-muted-foreground text-sm mb-6">Join thousands of users who protect their privacy with GetOTPs.</p>
          <Link href="/register">
            <a><Button size="lg" className="px-10" data-testid="button-cta-register">Create Free Account</Button></a>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <Logo size={24} />
          <p className="text-xs text-muted-foreground">© 2025 GetOTPs. All rights reserved.</p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <Link href="/api-docs"><a className="hover:text-foreground transition-colors">API</a></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
