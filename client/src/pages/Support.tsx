import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

export default function SupportPage() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();
  const { data: tickets } = useQuery<any[]>({ queryKey: ["/api/support"] });

  const createTicket = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support", { subject, message });
      return res.json();
    },
    onSuccess: () => {
      setSubject("");
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/support"] });
    },
  });

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-xl font-bold">Support</h1>
        <Card>
          <CardHeader><CardTitle>Create Ticket</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea placeholder="Describe your issue" value={message} onChange={(e) => setMessage(e.target.value)} />
            <Button onClick={() => createTicket.mutate()} disabled={!subject || !message || createTicket.isPending}>
              Submit Ticket
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Your Tickets</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(tickets || []).map((t) => (
              <div key={t.id} className="rounded border p-3">
                <p className="font-medium text-sm">{t.subject}</p>
                <p className="text-xs text-muted-foreground">Status: {t.status}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
