export default function Refund() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-16 max-w-4xl">
        <h1 className="text-4xl font-bold mb-6">Refund Policy</h1>
        <div className="space-y-4 text-muted-foreground leading-7">
          <p>
            We process refunds for failed or undelivered OTP orders automatically when upstream providers
            confirm cancellation or timeout.
          </p>
          <p>
            Successful OTP deliveries are non-refundable. Account balance top-ups may be refunded within 7
            days if unused and requested through support.
          </p>
          <p>
            For disputes, include your order ID, timestamp, and destination service in your support request.
          </p>
        </div>
      </div>
    </div>
  );
}
