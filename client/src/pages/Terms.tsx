import { Link } from "wouter";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/">
            <a><Logo size={28} /></a>
          </Link>
          <Link href="/">
            <a><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button></a>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Acceptance of Terms</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              By accessing or using GetOTPs ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, you may not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. Service Description</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              GetOTPs provides temporary virtual US phone numbers for receiving SMS verification codes. Numbers are rented for a limited time (typically 20 minutes) and are shared resources — they may be reused by other users after your session expires.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. Account Responsibilities</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You are responsible for maintaining the confidentiality of your account credentials and API key. You agree not to share your account or use the Service for illegal activities, spam, fraud, or harassment.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. Payments & Refunds</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Payments are made via cryptocurrency deposits. Funds added to your account balance are non-refundable except in cases where a number rental is cancelled before receiving any SMS — in which case the rental fee is refunded to your account balance (not to your original payment method).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. Prohibited Uses</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You may not use the Service to: (a) violate any laws or regulations; (b) engage in fraud or identity theft; (c) send spam or unsolicited messages; (d) abuse or overload the system; (e) resell access without authorization.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">6. Service Availability</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We strive for 99.9% uptime but do not guarantee uninterrupted service. Phone number availability depends on third-party providers and may vary. We are not liable for SMS delivery failures caused by the target service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">7. Limitation of Liability</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              GetOTPs is provided "as is" without warranties of any kind. We are not liable for any indirect, incidental, or consequential damages arising from your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">8. Changes to Terms</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We reserve the right to modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">9. Contact</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              For questions about these terms, contact us at support@getotps.com.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
