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
  X,
  Check,
  Sparkles,
} from "lucide-react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useState, useEffect, useRef } from "react";

// -- Data --

const POPULAR_SERVICES = [
  { name: "WhatsApp", price: "0.50" },
  { name: "Google", price: "0.45" },
  { name: "Telegram", price: "0.35" },
  { name: "Facebook", price: "0.40" },
  { name: "Instagram", price: "0.45" },
  { name: "Twitter / X", price: "0.35" },
  { name: "TikTok", price: "0.40" },
  { name: "Discord", price: "0.30" },
  { name: "Amazon", price: "0.55" },
  { name: "Uber", price: "0.60" },
  { name: "PayPal", price: "0.70" },
  { name: "Coinbase", price: "0.75" },
];

const FEATURES = [
  { icon: Zap, title: "Instant Delivery", desc: "OTP codes appear in your dashboard within seconds. No waiting.", color: "text-yellow-500", bg: "bg-yellow-500/10" },
  { icon: Shield, title: "100% Anonymous", desc: "Your real number stays private. Disposable numbers per verification.", color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { icon: Globe, title: "500+ Services", desc: "WhatsApp, Google, Telegram, Instagram, and hundreds more.", color: "text-blue-500", bg: "bg-blue-500/10" },
  { icon: Clock, title: "24/7 Available", desc: "Service runs around the clock. Get verified any time.", color: "text-orange-500", bg: "bg-orange-500/10" },
  { icon: DollarSign, title: "Pay Per Use", desc: "No subscriptions. Pay only for the numbers you use.", color: "text-green-500", bg: "bg-green-500/10" },
  { icon: Sparkles, title: "Auto-Confirm Deposits", desc: "USDT TRC20 deposits are detected and credited automatically.", color: "text-purple-500", bg: "bg-purple-500/10" },
];

const STEPS = [
  { step: "01", title: "Create Account", desc: "Sign up in 30 seconds. No credit card needed.", icon: Smartphone },
  { step: "02", title: "Add Funds", desc: "Deposit USDT or other crypto. Auto-confirmed in minutes.", icon: DollarSign },
  { step: "03", title: "Get Your OTP", desc: "Pick a service, get a US number, receive your code instantly.", icon: MessageSquare },
];

const COMPARISON = [
  { feature: "Real US phone numbers", us: true, them: false },
  { feature: "OTP delivery under 30 seconds", us: true, them: false },
  { feature: "No monthly subscription", us: true, them: false },
  { feature: "Auto-confirmed crypto deposits", us: true, them: false },
  { feature: "500+ supported services", us: true, them: "partial" },
  { feature: "Full refund on no-SMS cancel", us: true, them: false },
  { feature: "24/7 availability", us: true, them: true },
];

const FAQS = [
  { q: "What is GetOTPs?", a: "GetOTPs is a virtual phone number service that lets you receive SMS verification codes for 500+ apps and websites without exposing your personal phone number." },
  { q: "How quickly will I receive my OTP?", a: "Most OTP codes arrive within 10-30 seconds. Our dashboard auto-refreshes so you see the code the moment it arrives." },
  { q: "How long do I keep the number?", a: "Each number is rented for 20 minutes. If no SMS arrives, you can cancel for a full refund — no charge." },
  { q: "What payment methods do you accept?", a: "We accept cryptocurrency deposits including BTC, ETH, USDT (TRC20 & ERC20), USDC, and LTC. USDT TRC20 deposits are auto-confirmed." },
  { q: "Is this legal?", a: "Yes. GetOTPs provides legitimate virtual phone numbers for privacy-conscious users who want to verify accounts without sharing personal information." },
  { q: "Can I get a refund?", a: "If no SMS is received within 20 minutes, you can cancel the order and your balance is refunded instantly. Crypto deposits are non-refundable once credited." },
];

// -- Animations --

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5 } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

function AnimatedCounter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, v => Math.round(v));
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    const controls = animate(count, target, { duration: 2, ease: "easeOut" });
    const unsub = rounded.on("change", v => setDisplay(String(v)));
    return () => { controls.stop(); unsub(); };
  }, [target]);

  return <span>{display}{suffix}</span>;
}

function Section({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <motion.section id={id} className={className} initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} variants={stagger}>
      {children}
    </motion.section>
  );
}

// -- Component --

export default function Landing() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const { data: services } = useQuery<any[]>({ queryKey: ["/api/services"] });

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* ===== NAVBAR ===== */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Logo size={28} />
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {["features", "services", "pricing", "faq"].map(id => (
              <button key={id} onClick={() => scrollTo(id)} className="text-muted-foreground hover:text-foreground transition-colors capitalize">{id}</button>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-accent transition-colors">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {user ? (
              <Link href="/dashboard"><a><Button size="sm">Dashboard</Button></a></Link>
            ) : (
              <>
                <Link href="/login"><a><Button variant="ghost" size="sm">Sign In</Button></a></Link>
                <Link href="/register"><a><Button size="sm">Get Started</Button></a></Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section className="relative py-24 md:py-36 overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gradient-to-br from-primary/10 via-cyan-500/5 to-purple-500/5 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: "8s" }} />
          <div className="absolute top-40 -right-20 w-[400px] h-[400px] bg-cyan-500/8 rounded-full blur-[80px]" />
          <div className="absolute bottom-0 -left-20 w-[300px] h-[300px] bg-purple-500/5 rounded-full blur-[60px]" />
        </div>

        <motion.div className="max-w-4xl mx-auto px-4 text-center relative" initial="hidden" animate="visible" variants={stagger}>
          <motion.div variants={fadeUp}>
            <Badge variant="secondary" className="mb-6 text-xs font-medium px-4 py-1.5 gap-1.5">
              <Sparkles className="w-3 h-3" />
              Trusted by thousands of users worldwide
            </Badge>
          </motion.div>

          <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-[1.08]">
            SMS Verification
            <br />
            <span className="bg-gradient-to-r from-primary via-cyan-400 to-primary bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_3s_ease-in-out_infinite]">
              Without the Risk
            </span>
          </motion.h1>

          <motion.p variants={fadeUp} className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Get instant, disposable US phone numbers to verify any app or service.
            Keep your real number private. Starting at just <span className="text-foreground font-semibold">$0.15</span>.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register">
              <a><Button size="lg" className="w-full sm:w-auto px-8 text-base h-12 shadow-lg shadow-primary/20">Get Started Free <ArrowRight className="w-4 h-4 ml-2" /></Button></a>
            </Link>
            <Button size="lg" variant="outline" className="w-full sm:w-auto px-8 text-base h-12" onClick={() => scrollTo("pricing")}>
              View Pricing
            </Button>
          </motion.div>

          <motion.div variants={fadeUp} className="mt-12 flex items-center justify-center gap-6 sm:gap-8 text-sm text-muted-foreground flex-wrap">
            {[
              { icon: CheckCircle2, text: "No subscription" },
              { icon: Shield, text: "Anonymous" },
              { icon: Zap, text: "Instant delivery" },
              { icon: DollarSign, text: "Auto-confirm deposits" },
            ].map(item => (
              <span key={item.text} className="flex items-center gap-1.5">
                <item.icon className="w-3.5 h-3.5 text-primary" />
                {item.text}
              </span>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ===== SOCIAL PROOF STATS ===== */}
      <section className="border-y border-border bg-muted/20">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <motion.div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}>
            {[
              { label: "Services Supported", value: 500, suffix: "+" },
              { label: "Uptime SLA", value: 99, suffix: ".9%" },
              { label: "Avg Delivery", value: 30, suffix: "s" },
              { label: "Starting From", value: 0, suffix: "", display: "$0.15" },
            ].map(stat => (
              <motion.div key={stat.label} variants={fadeUp}>
                <p className="text-3xl md:text-4xl font-extrabold text-foreground">
                  {stat.display || <AnimatedCounter target={stat.value} suffix={stat.suffix} />}
                </p>
                <p className="text-xs text-muted-foreground mt-1.5 font-medium">{stat.label}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <Section id="features" className="py-20 md:py-28 max-w-6xl mx-auto px-4">
        <motion.div variants={fadeUp} className="text-center mb-16">
          <Badge variant="secondary" className="mb-4 text-xs">Why GetOTPs</Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything You Need for SMS Verification</h2>
          <p className="text-muted-foreground max-w-lg mx-auto text-lg">Built for privacy, speed, and simplicity.</p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(f => (
            <motion.div key={f.title} variants={fadeUp}>
              <Card className="border-border hover:border-primary/20 transition-all h-full hover:shadow-lg hover:shadow-primary/5 group">
                <CardContent className="p-6">
                  <div className={`w-11 h-11 rounded-xl ${f.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <f.icon className={`w-5 h-5 ${f.color}`} />
                  </div>
                  <h3 className="font-semibold mb-2 text-lg">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ===== HOW IT WORKS ===== */}
      <Section className="py-20 md:py-28 bg-muted/20 border-y border-border">
        <div className="max-w-6xl mx-auto px-4">
          <motion.div variants={fadeUp} className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 text-xs">Simple Process</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Get Verified in 3 Steps</h2>
            <p className="text-muted-foreground text-lg">No complicated setup. Under 2 minutes.</p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((item, idx) => (
              <motion.div key={item.step} variants={fadeUp} className="relative">
                <Card className="border-border h-full hover:shadow-lg transition-shadow">
                  <CardContent className="p-8 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
                      <item.icon className="w-7 h-7 text-primary" />
                    </div>
                    <div className="text-xs font-bold text-primary mb-2 tracking-[0.2em]">STEP {item.step}</div>
                    <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
                {idx < 2 && <div className="hidden md:block absolute top-1/2 -right-4 w-8 h-[2px] bg-border" />}
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ===== SERVICES ===== */}
      <Section id="services" className="py-20 md:py-28 max-w-6xl mx-auto px-4">
        <motion.div variants={fadeUp} className="text-center mb-16">
          <Badge variant="secondary" className="mb-4 text-xs">Service Catalog</Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Popular Services</h2>
          <p className="text-muted-foreground text-lg">Verify accounts across all major platforms.</p>
        </motion.div>

        <motion.div variants={fadeUp} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {(services || POPULAR_SERVICES).slice(0, 12).map((svc: any, idx: number) => (
            <Card key={idx} className="border-border hover:border-primary/40 transition-all hover:shadow-md cursor-pointer group">
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                  <span className="text-xs font-bold text-primary">{(svc.name || "").slice(0, 2).toUpperCase()}</span>
                </div>
                <p className="text-xs font-medium truncate">{svc.name}</p>
                <p className="text-xs text-primary font-bold mt-1">${svc.price}</p>
              </CardContent>
            </Card>
          ))}
        </motion.div>

        <motion.div variants={fadeUp} className="text-center mt-8">
          <Link href="/register"><a><Button variant="outline" size="lg">Browse All 500+ Services <ArrowRight className="w-4 h-4 ml-2" /></Button></a></Link>
        </motion.div>
      </Section>

      {/* ===== COMPARISON ===== */}
      <Section className="py-20 md:py-28 bg-muted/20 border-y border-border">
        <div className="max-w-3xl mx-auto px-4">
          <motion.div variants={fadeUp} className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 text-xs">Why Switch</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">GetOTPs vs The Rest</h2>
            <p className="text-muted-foreground text-lg">See how we compare to other SMS verification services.</p>
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card className="border-border overflow-hidden">
              <CardContent className="p-0">
                <div className="grid grid-cols-3 text-center border-b border-border bg-muted/30">
                  <div className="p-4 text-xs font-semibold text-muted-foreground text-left pl-6">Feature</div>
                  <div className="p-4 text-xs font-bold text-primary">GetOTPs</div>
                  <div className="p-4 text-xs font-semibold text-muted-foreground">Others</div>
                </div>
                {COMPARISON.map((row, i) => (
                  <div key={i} className="grid grid-cols-3 text-center border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <div className="p-3.5 text-sm text-left pl-6">{row.feature}</div>
                    <div className="p-3.5 flex items-center justify-center">
                      <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      </div>
                    </div>
                    <div className="p-3.5 flex items-center justify-center">
                      {row.them === true ? (
                        <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center"><Check className="w-3.5 h-3.5 text-green-500" /></div>
                      ) : row.them === "partial" ? (
                        <span className="text-xs text-muted-foreground">Partial</span>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-red-500/10 flex items-center justify-center"><X className="w-3.5 h-3.5 text-red-500" /></div>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </Section>

      {/* ===== PRICING ===== */}
      <Section id="pricing" className="py-20 md:py-28 max-w-4xl mx-auto px-4">
        <motion.div variants={fadeUp} className="text-center mb-16">
          <Badge variant="secondary" className="mb-4 text-xs">Pricing</Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple, Pay-Per-Use Pricing</h2>
          <p className="text-muted-foreground text-lg">No monthly fees. No minimums. Pay only for what you use.</p>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card className="border-primary/20 overflow-hidden shadow-lg shadow-primary/5">
            <CardContent className="p-0">
              <div className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 p-8 text-center border-b border-border">
                <h3 className="text-2xl font-bold mb-2">Pay As You Go</h3>
                <p className="text-muted-foreground">Each service has a fixed per-use price. No hidden fees.</p>
              </div>
              <div className="p-8">
                <div className="grid sm:grid-cols-2 gap-4 mb-8">
                  {[
                    { range: "Messaging Apps", price: "$0.30 – $0.60", examples: "WhatsApp, Telegram, Discord" },
                    { range: "Social Media", price: "$0.35 – $0.50", examples: "Instagram, TikTok, Twitter" },
                    { range: "Tech & Email", price: "$0.40 – $0.55", examples: "Google, Microsoft, Apple" },
                    { range: "Finance & Crypto", price: "$0.60 – $0.80", examples: "PayPal, Coinbase, Binance" },
                  ].map(tier => (
                    <div key={tier.range} className="p-5 rounded-xl border border-border hover:border-primary/20 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold">{tier.range}</span>
                        <span className="text-sm font-bold text-primary">{tier.price}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{tier.examples}</p>
                    </div>
                  ))}
                </div>
                <Separator className="my-6" />
                <div className="grid sm:grid-cols-2 gap-3 mb-8">
                  {[
                    "20-minute number rental",
                    "Automatic OTP extraction",
                    "Full refund on no-SMS cancel",
                    "Auto-confirmed USDT deposits",
                    "Real US phone numbers",
                    "Instant balance updates",
                  ].map(item => (
                    <div key={item} className="flex items-center gap-2.5 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <div className="text-center">
                  <Link href="/register">
                    <a><Button size="lg" className="px-12 h-12 text-base shadow-lg shadow-primary/20">Start Now <ArrowRight className="w-4 h-4 ml-2" /></Button></a>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </Section>

      {/* ===== FAQ ===== */}
      <Section id="faq" className="py-20 md:py-28 bg-muted/20 border-y border-border">
        <div className="max-w-3xl mx-auto px-4">
          <motion.div variants={fadeUp} className="text-center mb-16">
            <Badge variant="secondary" className="mb-4 text-xs">FAQ</Badge>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Common Questions</h2>
          </motion.div>

          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <motion.div key={i} variants={fadeUp}>
                <Card className="border-border overflow-hidden">
                  <CardContent className="p-0">
                    <button className="flex items-center justify-between w-full p-5 text-left hover:bg-muted/30 transition-colors" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                      <span className="font-medium pr-4">{faq.q}</span>
                      {openFaq === i ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                    </button>
                    {openFaq === i && (
                      <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed border-t border-border pt-4">{faq.a}</div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ===== CTA ===== */}
      <section className="py-24 md:py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-primary/[0.02] to-transparent pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/[0.08] rounded-full blur-[100px] pointer-events-none" />
        <motion.div className="max-w-2xl mx-auto px-4 text-center relative" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger}>
          <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-bold mb-5">Ready to Protect Your Privacy?</motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground mb-10 text-lg">Join thousands of users who verify accounts without exposing their personal number.</motion.p>
          <motion.div variants={fadeUp}>
            <Link href="/register">
              <a><Button size="lg" className="px-12 h-12 text-base shadow-lg shadow-primary/20">Create Free Account <ArrowRight className="w-4 h-4 ml-2" /></Button></a>
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-border bg-muted/20">
        <div className="max-w-6xl mx-auto px-4 py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div className="col-span-2 md:col-span-1">
              <Logo size={24} />
              <p className="text-xs text-muted-foreground mt-3 leading-relaxed max-w-[200px]">
                Virtual phone numbers for SMS verification. Fast, private, affordable.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Product</h4>
              <ul className="space-y-2.5 text-sm">
                {[
                  { label: "Features", action: () => scrollTo("features") },
                  { label: "Pricing", action: () => scrollTo("pricing") },
                  { label: "Services", action: () => scrollTo("services") },
                ].map(l => (
                  <li key={l.label}><button onClick={l.action} className="text-muted-foreground hover:text-foreground transition-colors">{l.label}</button></li>
                ))}
                <li><Link href="/register"><a className="text-muted-foreground hover:text-foreground transition-colors">Get Started</a></Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Support</h4>
              <ul className="space-y-2.5 text-sm">
                <li><button onClick={() => scrollTo("faq")} className="text-muted-foreground hover:text-foreground transition-colors">FAQ</button></li>
                <li><Link href="/terms"><a className="text-muted-foreground hover:text-foreground transition-colors">Terms of Service</a></Link></li>
                <li><Link href="/privacy"><a className="text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</a></Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Payment</h4>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li>USDT (TRC20)</li>
                <li>Bitcoin</li>
                <li>Ethereum</li>
                <li>USDC / LTC</li>
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

      {/* Shimmer animation keyframe */}
      <style>{`
        @keyframes shimmer {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
      `}</style>
    </div>
  );
}
