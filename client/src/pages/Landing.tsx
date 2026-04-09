import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Moon,
  Sun,
  Zap,
  Shield,
  Globe,
  Clock,
  Code2,
  DollarSign,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  Smartphone,
} from "lucide-react";
import { motion } from "framer-motion";
import { useState, useRef } from "react";

// -- Data --

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

const FEATURES = [
  {
    icon: Zap,
    title: "Instant Delivery",
    desc: "OTP codes appear in your dashboard within seconds. No waiting, no delays.",
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
  },
  {
    icon: Shield,
    title: "100% Anonymous",
    desc: "Your real number stays private. Disposable numbers protect your identity.",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
  {
    icon: Globe,
    title: "500+ Services",
    desc: "Works with WhatsApp, Google, Telegram, Instagram, and hundreds more.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: Code2,
    title: "Developer API",
    desc: "Full REST API with key-based auth. Automate OTP workflows in your apps.",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  {
    icon: DollarSign,
    title: "Pay Per Use",
    desc: "No subscriptions or commitments. Pay only for the numbers you use.",
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
  {
    icon: Clock,
    title: "24/7 Available",
    desc: "Service runs around the clock. Get verified any time, day or night.",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Create Account",
    desc: "Sign up in 30 seconds. No credit card required to get started.",
    icon: Smartphone,
  },
  {
    step: "02",
    title: "Add Funds",
    desc: "Deposit via cryptocurrency. Top up with as little as $1.",
    icon: DollarSign,
  },
  {
    step: "03",
    title: "Get Your OTP",
    desc: "Pick a service, get a US number, and receive your code instantly.",
    icon: MessageSquare,
  },
];

const FAQS = [
  {
    q: "What is GetOTPs?",
    a: "GetOTPs is a virtual phone number service that lets you receive SMS verification codes for 500+ apps and websites without exposing your personal phone number.",
  },
  {
    q: "How quickly will I receive my OTP?",
    a: "Most OTP codes arrive within 10-30 seconds. Our dashboard auto-refreshes so you see the code the moment it arrives.",
  },
  {
    q: "How long do I keep the number?",
    a: "Each number is rented for 20 minutes. If no SMS arrives in that time, you can cancel for a full refund — no charge.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept cryptocurrency deposits including BTC, ETH, USDT (TRC20 & ERC20), USDC, and LTC. Deposits are credited after blockchain confirmation.",
  },
  {
    q: "Can I integrate this into my own app?",
    a: "Yes! Every account gets a unique API key. Our REST API lets you request numbers, check for SMS, and cancel orders programmatically.",
  },
  {
    q: "Is this legal?",
    a: "Yes. GetOTPs provides legitimate virtual phone numbers for privacy-conscious users who want to verify accounts without sharing personal information. Always comply with the terms of services you are verifying with.",
  },
];

// -- Animations --

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

function Section({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <motion.section
      id={id}
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={stagger}
    >
      {children}
    </motion.section>
  );
}

// -- Component --

export default function Landing() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const { data: services } = useQuery<any[]>({
    queryKey: ["/api/services"],
  });

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* ========== NAVBAR ========== */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Logo size={28} />
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <button onClick={() => scrollTo("features")} className="text-muted-foreground hover:text-foreground transition-colors">Features</button>
            <button onClick={() => scrollTo("services")} className="text-muted-foreground hover:text-foreground transition-colors">Services</button>
            <button onClick={() => scrollTo("pricing")} className="text-muted-foreground hover:text-foreground transition-colors">Pricing</button>
            <button onClick={() => scrollTo("faq")} className="text-muted-foreground hover:text-foreground transition-colors">FAQ</button>
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-accent transition-colors">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {user ? (
              <Link href="/dashboard">
                <a><Button size="sm">Dashboard</Button></a>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <a><Button variant="ghost" size="sm">Sign In</Button></a>
                </Link>
                <Link href="/register">
                  <a><Button size="sm">Get Started</Button></a>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ========== HERO ========== */}
      <section className="relative py-24 md:py-32 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.04] via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/[0.06] rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute top-40 right-10 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-10 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

        <motion.div
          className="max-w-4xl mx-auto px-4 text-center relative"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <motion.div variants={fadeUp}>
            <Badge variant="secondary" className="mb-5 text-xs font-medium px-3 py-1">
              Trusted by developers & businesses worldwide
            </Badge>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-[1.1]"
          >
            SMS Verification
            <br />
            <span className="bg-gradient-to-r from-primary via-cyan-400 to-primary bg-clip-text text-transparent">
              Without the Risk
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            Get instant, disposable US phone numbers to verify any app or service.
            Keep your real number private. Starting at just{" "}
            <span className="text-foreground font-semibold">$0.15</span>.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Link href="/register">
              <a>
                <Button size="lg" className="w-full sm:w-auto px-8 text-base h-12">
                  Get Started Free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </a>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="w-full sm:w-auto px-8 text-base h-12"
              onClick={() => scrollTo("pricing")}
            >
              View Pricing
            </Button>
          </motion.div>

          {/* Trust bar */}
          <motion.div variants={fadeUp} className="mt-12 flex items-center justify-center gap-6 text-sm text-muted-foreground">
            {[
              { icon: CheckCircle2, text: "No subscription" },
              { icon: Shield, text: "Anonymous" },
              { icon: Zap, text: "Instant delivery" },
            ].map(item => (
              <span key={item.text} className="flex items-center gap-1.5">
                <item.icon className="w-3.5 h-3.5 text-primary" />
                {item.text}
              </span>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ========== STATS BAR ========== */}
      <section className="border-y border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { label: "Services", value: "500+" },
              { label: "Uptime", value: "99.9%" },
              { label: "Avg. Delivery", value: "<30s" },
              { label: "Starting From", value: "$0.15" },
            ].map(stat => (
              <div key={stat.label}>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== FEATURES ========== */}
      <Section id="features" className="py-20 max-w-6xl mx-auto px-4">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <Badge variant="secondary" className="mb-3 text-xs">Why GetOTPs</Badge>
          <h2 className="text-3xl font-bold mb-3">Everything You Need for SMS Verification</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Built for developers, privacy enthusiasts, and businesses who need reliable OTP delivery.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(f => (
            <motion.div key={f.title} variants={fadeUp}>
              <Card className="border-border hover:border-primary/20 transition-all h-full hover:shadow-sm">
                <CardContent className="p-6">
                  <div className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-4`}>
                    <f.icon className={`w-5 h-5 ${f.color}`} />
                  </div>
                  <h3 className="font-semibold mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ========== HOW IT WORKS ========== */}
      <Section className="py-20 bg-muted/20 border-y border-border">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div variants={fadeUp} className="text-center mb-14">
            <Badge variant="secondary" className="mb-3 text-xs">Simple Process</Badge>
            <h2 className="text-3xl font-bold mb-3">Get Verified in 3 Steps</h2>
            <p className="text-muted-foreground">No complicated setup. Start receiving OTP codes in under 2 minutes.</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((item, idx) => (
              <motion.div key={item.step} variants={fadeUp} className="relative">
                <Card className="border-border h-full">
                  <CardContent className="p-6 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <item.icon className="w-6 h-6 text-primary" />
                    </div>
                    <div className="text-xs font-bold text-primary mb-2 tracking-widest">STEP {item.step}</div>
                    <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
                {/* Connector line */}
                {idx < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-[2px] bg-border" />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ========== SERVICES ========== */}
      <Section id="services" className="py-20 max-w-6xl mx-auto px-4">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <Badge variant="secondary" className="mb-3 text-xs">Service Catalog</Badge>
          <h2 className="text-3xl font-bold mb-3">Popular Services</h2>
          <p className="text-muted-foreground">Verify accounts across all major platforms and apps.</p>
        </motion.div>

        <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {(services || POPULAR_SERVICES).slice(0, 12).map((svc: any, idx: number) => (
            <Card
              key={idx}
              className="border-border hover:border-primary/40 transition-all hover:shadow-sm cursor-pointer group"
            >
              <CardContent className="p-4 text-center">
                <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">
                  {svc.icon || "📱"}
                </div>
                <p className="text-xs font-medium truncate">{svc.name}</p>
                <p className="text-xs text-primary font-semibold mt-1">${svc.price}</p>
              </CardContent>
            </Card>
          ))}
        </motion.div>

        <motion.div variants={fadeUp} className="text-center mt-8">
          <Link href="/register">
            <a><Button variant="outline">Browse All 500+ Services <ArrowRight className="w-3.5 h-3.5 ml-1.5" /></Button></a>
          </Link>
        </motion.div>
      </Section>

      {/* ========== PRICING ========== */}
      <Section id="pricing" className="py-20 bg-muted/20 border-y border-border">
        <div className="max-w-4xl mx-auto px-4">
          <motion.div variants={fadeUp} className="text-center mb-14">
            <Badge variant="secondary" className="mb-3 text-xs">Pricing</Badge>
            <h2 className="text-3xl font-bold mb-3">Simple, Pay-Per-Use Pricing</h2>
            <p className="text-muted-foreground">No monthly fees. No minimums. Pay only for what you use.</p>
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card className="border-border overflow-hidden">
              <CardContent className="p-0">
                {/* Pricing header */}
                <div className="bg-primary/5 p-6 text-center border-b border-border">
                  <h3 className="text-lg font-bold mb-1">Pay As You Go</h3>
                  <p className="text-sm text-muted-foreground">
                    Each service has a fixed per-use price. No hidden fees.
                  </p>
                </div>

                {/* Price examples */}
                <div className="p-6">
                  <div className="grid sm:grid-cols-2 gap-4 mb-6">
                    {[
                      { range: "Messaging Apps", price: "$0.30 - $0.60", examples: "WhatsApp, Telegram, Discord" },
                      { range: "Social Media", price: "$0.35 - $0.50", examples: "Instagram, TikTok, Twitter" },
                      { range: "Tech & Email", price: "$0.40 - $0.55", examples: "Google, Microsoft, Apple" },
                      { range: "Finance & Crypto", price: "$0.60 - $0.80", examples: "PayPal, Coinbase, Binance" },
                    ].map(tier => (
                      <div key={tier.range} className="p-4 rounded-lg border border-border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold">{tier.range}</span>
                          <span className="text-sm font-bold text-primary">{tier.price}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{tier.examples}</p>
                      </div>
                    ))}
                  </div>

                  {/* What's included */}
                  <Separator className="my-6" />
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[
                      "20-minute number rental",
                      "Automatic OTP extraction",
                      "Full refund on no-SMS cancel",
                      "REST API access included",
                      "Real US phone numbers",
                      "Crypto deposits accepted",
                    ].map(item => (
                      <div key={item} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8 text-center">
                    <Link href="/register">
                      <a>
                        <Button size="lg" className="px-10 h-12">
                          Start Now <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </a>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </Section>

      {/* ========== FAQ ========== */}
      <Section id="faq" className="py-20 max-w-3xl mx-auto px-4">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <Badge variant="secondary" className="mb-3 text-xs">FAQ</Badge>
          <h2 className="text-3xl font-bold mb-3">Frequently Asked Questions</h2>
          <p className="text-muted-foreground">Everything you need to know before getting started.</p>
        </motion.div>

        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <motion.div key={i} variants={fadeUp}>
              <Card className="border-border overflow-hidden">
                <CardContent className="p-0">
                  <button
                    className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    <span className="font-medium text-sm pr-4">{faq.q}</span>
                    {openFaq === i ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                  </button>
                  {openFaq === i && (
                    <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
                      {faq.a}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ========== CTA ========== */}
      <section className="py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-primary/[0.02] to-transparent pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-primary/[0.06] rounded-full blur-[80px] pointer-events-none" />
        <motion.div
          className="max-w-2xl mx-auto px-4 text-center relative"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-3xl font-bold mb-4">
            Ready to Protect Your Privacy?
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground mb-8 text-lg">
            Join thousands of users who verify accounts without exposing their personal number.
          </motion.p>
          <motion.div variants={fadeUp}>
            <Link href="/register">
              <a>
                <Button size="lg" className="px-10 h-12 text-base">
                  Create Free Account
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </a>
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="border-t border-border bg-muted/20">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <Logo size={24} />
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                Virtual phone numbers for SMS verification. Fast, private, affordable.
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><button onClick={() => scrollTo("features")} className="text-muted-foreground hover:text-foreground transition-colors">Features</button></li>
                <li><button onClick={() => scrollTo("pricing")} className="text-muted-foreground hover:text-foreground transition-colors">Pricing</button></li>
                <li><button onClick={() => scrollTo("services")} className="text-muted-foreground hover:text-foreground transition-colors">Services</button></li>
                <li><Link href="/register"><a className="text-muted-foreground hover:text-foreground transition-colors">Get Started</a></Link></li>
              </ul>
            </div>

            {/* Developers */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Developers</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/api-docs"><a className="text-muted-foreground hover:text-foreground transition-colors">API Documentation</a></Link></li>
                <li><button onClick={() => scrollTo("faq")} className="text-muted-foreground hover:text-foreground transition-colors">FAQ</button></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/terms"><a className="text-muted-foreground hover:text-foreground transition-colors">Terms of Service</a></Link></li>
                <li><Link href="/privacy"><a className="text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</a></Link></li>
              </ul>
            </div>
          </div>

          <Separator />
          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} GetOTPs. All rights reserved.</p>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <Link href="/terms"><a className="hover:text-foreground transition-colors">Terms</a></Link>
              <Link href="/privacy"><a className="hover:text-foreground transition-colors">Privacy</a></Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
