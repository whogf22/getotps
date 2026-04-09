import { Link } from "wouter";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Privacy() {
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
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Information We Collect</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We collect the minimum information necessary to provide the Service: your username, email address, and hashed password. We also store transaction records, order history, and API usage logs associated with your account.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. How We Use Your Information</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your information is used to: (a) provide and maintain the Service; (b) process payments and manage your account balance; (c) communicate about your account or orders; (d) detect and prevent fraud or abuse.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. SMS Data</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              SMS messages received on rented numbers are displayed to you in real time and stored temporarily in your order history. We do not share SMS content with third parties. SMS data is retained for 30 days after order completion, then permanently deleted.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. Payment Information</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We do not store credit card numbers. Cryptocurrency deposit transactions are recorded by wallet address and transaction hash for verification purposes. We do not track or store your personal crypto wallet addresses beyond the transaction.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. Data Security</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Passwords are hashed using bcrypt. Sessions are stored securely server-side. API keys are generated using cryptographically secure random bytes. We use HTTPS in production to encrypt data in transit.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">6. Cookies</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We use a single session cookie to maintain your login state. We do not use tracking cookies, advertising cookies, or third-party analytics cookies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">7. Third-Party Services</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We use third-party phone number providers to deliver virtual numbers and SMS messages. These providers may process phone numbers but do not have access to your GetOTPs account information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">8. Data Retention</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Account data is retained as long as your account is active. You may request account deletion by contacting support. Upon deletion, all personal data and order history will be permanently removed within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">9. Your Rights</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You have the right to: access your personal data, request corrections, request deletion, and export your data. Contact support@getotps.com to exercise these rights.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">10. Contact</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              For privacy-related questions or concerns, contact us at support@getotps.com.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
