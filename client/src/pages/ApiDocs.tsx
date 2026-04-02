import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check, Key } from "lucide-react";

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto font-mono leading-relaxed text-foreground border border-border">
        <code>{code}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2.5 right-2.5 p-1.5 rounded bg-background border border-border opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        data-testid="button-copy-code"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    POST: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    PUT: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    DELETE: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold ${colors[method] || "bg-muted"}`}>{method}</span>;
}

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/v1/services",
    desc: "List all available services with pricing",
    auth: false,
    response: `[{ "id": 1, "name": "WhatsApp", "slug": "whatsapp", "price": "0.50", "icon": "📱" }]`,
  },
  {
    method: "GET",
    path: "/api/v1/balance",
    desc: "Get your current account balance",
    auth: true,
    response: `{ "balance": "24.50" }`,
  },
  {
    method: "POST",
    path: "/api/v1/order",
    desc: "Create a new order — buy a phone number for a service",
    auth: true,
    body: `{ "service": "whatsapp" }`,
    response: `{ "orderId": 42, "phoneNumber": "+12125551234", "status": "waiting", "expiresAt": "..." }`,
  },
  {
    method: "GET",
    path: "/api/v1/order/:id",
    desc: "Check order status and retrieve OTP code",
    auth: true,
    response: `{ "orderId": 42, "phoneNumber": "+12125551234", "status": "received", "otpCode": "847291" }`,
  },
  {
    method: "POST",
    path: "/api/v1/order/:id/cancel",
    desc: "Cancel an active order and receive a refund",
    auth: true,
    response: `{ "message": "Order cancelled and refunded" }`,
  },
];

const CRYPTO_ENDPOINTS = [
  {
    method: "GET",
    path: "/api/crypto/currencies",
    desc: "List supported cryptocurrencies, wallet addresses, and current rates",
    auth: true,
    response: `[{
  "id": "BTC",
  "name": "BTC",
  "network": "Bitcoin",
  "address": "bc1qxy2kgd...",
  "rate": 84250.00
}]`,
  },
  {
    method: "POST",
    path: "/api/crypto/create-deposit",
    desc: "Create a new crypto deposit request",
    auth: true,
    body: `{ "currency": "USDT_TRC20", "amount": 25 }`,
    response: `{
  "id": 1,
  "currency": "USDT_TRC20",
  "amount": "25.00",
  "cryptoAmount": "25.00000000",
  "walletAddress": "TN2Y5mFK...",
  "status": "pending",
  "expiresAt": "..."
}`,
  },
  {
    method: "POST",
    path: "/api/crypto/:id/submit-hash",
    desc: "Submit your transaction hash after sending crypto",
    auth: true,
    body: `{ "txHash": "0xabc123..." }`,
    response: `{ "message": "Transaction hash submitted. Awaiting confirmation." }`,
  },
  {
    method: "GET",
    path: "/api/crypto/deposits",
    desc: "Get your deposit history and statuses",
    auth: true,
    response: `[{
  "id": 1,
  "currency": "USDT_TRC20",
  "amount": "25.00",
  "status": "completed",
  "txHash": "0xabc123...",
  "createdAt": "..."
}]`,
  },
];

export default function ApiDocs() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("curl");

  const apiKey = user?.apiKey || "YOUR_API_KEY";

  const curlExample = `# List services
curl https://getotps.com/api/v1/services

# Check balance
curl -H "X-API-Key: ${apiKey}" \\
  https://getotps.com/api/v1/balance

# Buy a number
curl -X POST \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"service": "whatsapp"}' \\
  https://getotps.com/api/v1/order

# Check for OTP
curl -H "X-API-Key: ${apiKey}" \\
  https://getotps.com/api/v1/order/42

# Create crypto deposit
curl -X POST \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"currency": "USDT_TRC20", "amount": 25}' \\
  https://getotps.com/api/crypto/create-deposit`;

  const pythonExample = `import requests

API_KEY = "${apiKey}"
BASE_URL = "https://getotps.com/api/v1"

headers = {"X-API-Key": API_KEY}

# List services
r = requests.get(f"{BASE_URL}/services")
services = r.json()

# Buy a number
r = requests.post(f"{BASE_URL}/order",
    headers=headers,
    json={"service": "whatsapp"})
order = r.json()
print(f"Phone: {order['phoneNumber']}")

# Poll for OTP
import time
for _ in range(20):
    r = requests.get(f"{BASE_URL}/order/{order['orderId']}",
        headers=headers)
    data = r.json()
    if data.get("otpCode"):
        print(f"OTP: {data['otpCode']}")
        break
    time.sleep(10)

# Create crypto deposit
r = requests.post("https://getotps.com/api/crypto/create-deposit",
    headers=headers,
    json={"currency": "USDT_TRC20", "amount": 25})
deposit = r.json()
print(f"Send {deposit['cryptoAmount']} to {deposit['walletAddress']}")`;

  const nodeExample = `const API_KEY = "${apiKey}";
const BASE_URL = "https://getotps.com/api/v1";

// Buy a number
const res = await fetch(\`\${BASE_URL}/order\`, {
  method: "POST",
  headers: {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ service: "whatsapp" }),
});
const order = await res.json();
console.log("Phone:", order.phoneNumber);

// Poll for OTP
async function pollForOTP(orderId) {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const r = await fetch(\`\${BASE_URL}/order/\${orderId}\`, {
      headers: { "X-API-Key": API_KEY },
    });
    const data = await r.json();
    if (data.otpCode) return data.otpCode;
  }
}

// Create crypto deposit
const deposit = await fetch(
  "https://getotps.com/api/crypto/create-deposit",
  {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ currency: "USDT_TRC20", amount: 25 }),
  }
).then(r => r.json());
console.log("Send", deposit.cryptoAmount, "to", deposit.walletAddress);`;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-xl font-bold">API Documentation</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Integrate GetOTPs into your applications</p>
        </div>

        {/* API Key */}
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Key className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground mb-0.5">Your API Key</p>
                <p className="font-mono text-sm truncate" data-testid="text-api-key">
                  {user?.apiKey || "Generate an API key from your Profile page"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Auth */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Authentication</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Include your API key in the <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">X-API-Key</code> header for all authenticated requests.
            </p>
            <CodeBlock code={`X-API-Key: ${apiKey}`} />
          </CardContent>
        </Card>

        {/* Number / Order Endpoints */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide">Number & Order Endpoints</h2>
          {ENDPOINTS.map((ep, i) => (
            <Card key={i} className="border-border" data-testid={`card-endpoint-${i}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <MethodBadge method={ep.method} />
                  <code className="text-sm font-mono font-medium">{ep.path}</code>
                  {ep.auth && <Badge variant="secondary" className="text-xs h-5">Auth required</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{ep.desc}</p>
                {ep.body && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1.5">Request Body</p>
                    <CodeBlock code={ep.body} />
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">Response</p>
                  <CodeBlock code={ep.response} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Crypto Deposit Endpoints */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide">Crypto Deposit Endpoints</h2>
          {CRYPTO_ENDPOINTS.map((ep, i) => (
            <Card key={i} className="border-border" data-testid={`card-crypto-endpoint-${i}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <MethodBadge method={ep.method} />
                  <code className="text-sm font-mono font-medium">{ep.path}</code>
                  {ep.auth && <Badge variant="secondary" className="text-xs h-5">Auth required</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{ep.desc}</p>
                {ep.body && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1.5">Request Body</p>
                    <CodeBlock code={ep.body} />
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">Response</p>
                  <CodeBlock code={ep.response} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Code Examples */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide">Code Examples</h2>
          <div className="flex gap-2">
            {["curl", "python", "node"].map(tab => (
              <Button
                key={tab}
                size="sm"
                variant={activeTab === tab ? "default" : "outline"}
                onClick={() => setActiveTab(tab)}
                className="text-xs"
                data-testid={`button-tab-${tab}`}
              >
                {tab === "curl" ? "cURL" : tab === "python" ? "Python" : "Node.js"}
              </Button>
            ))}
          </div>
          <CodeBlock
            code={activeTab === "curl" ? curlExample : activeTab === "python" ? pythonExample : nodeExample}
            lang={activeTab}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
