type AlertLevel = "info" | "warning" | "critical";

export async function sendFinancialAlert(level: AlertLevel, event: string, payload: Record<string, unknown>): Promise<void> {
  const message = `[${level.toUpperCase()}] ${event}\n${JSON.stringify(payload)}`;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (botToken && chatId) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          disable_web_page_preview: true,
        }),
      });
    } catch (error) {
      console.error("Failed to send Telegram financial alert", error);
    }
  }

  // Email hook placeholder (kept additive and env-driven)
  const emailWebhook = process.env.FINANCIAL_ALERT_EMAIL_WEBHOOK;
  if (emailWebhook) {
    try {
      await fetch(emailWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, event, payload, message }),
      });
    } catch (error) {
      console.error("Failed to send email financial alert", error);
    }
  }
}
