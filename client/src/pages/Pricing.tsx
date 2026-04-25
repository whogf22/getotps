import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Pricing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-16 max-w-5xl">
        <h1 className="text-4xl font-bold mb-4">Pricing</h1>
        <p className="text-muted-foreground mb-8">
          Transparent pay-as-you-go OTP pricing with optional bundles for discounted volume.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { title: "Starter", price: "$10", note: "Best for testing and light use" },
            { title: "Growth", price: "$50", note: "Popular for recurring automation" },
            { title: "Scale", price: "$100", note: "Highest bonus + API workflow support" },
          ].map((tier) => (
            <Card key={tier.title}>
              <CardHeader>
                <CardTitle>{tier.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{tier.price}</p>
                <p className="text-sm text-muted-foreground mt-2">{tier.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-8 flex gap-3">
          <Link href="/register">
            <Button>Create Account</Button>
          </Link>
          <a href="/api/docs">
            <Button variant="outline">API Docs</Button>
          </a>
        </div>
      </div>
    </div>
  );
}
