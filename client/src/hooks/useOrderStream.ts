import { useEffect, useRef, useState } from "react";

type OrderStreamOptions = {
  enabled?: boolean;
};

export function useOrderStream(orderId: number | null | undefined, options: OrderStreamOptions = {}) {
  const enabled = options.enabled ?? true;
  const [latest, setLatest] = useState<any>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !orderId) {
      setStatus("idle");
      return;
    }

    const url = `/api/orders/${orderId}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;
    setStatus("connecting");
    setError(null);

    es.onopen = () => setStatus("open");
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        setLatest(parsed);
      } catch {
        // keep stream alive, ignore malformed payload
      }
    };
    es.addEventListener("end", () => {
      setStatus("closed");
      es.close();
    });
    es.onerror = () => {
      setStatus("error");
      setError("Order stream disconnected");
    };

    return () => {
      es.close();
      esRef.current = null;
      setStatus("closed");
    };
  }, [enabled, orderId]);

  return { latest, status, error };
}
