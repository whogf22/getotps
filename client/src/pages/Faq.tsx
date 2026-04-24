import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function FaqPage() {
  const { data } = useQuery<any[]>({ queryKey: ["/api/faq"] });

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-xl font-bold">FAQ</h1>
        {(data || []).map((f) => (
          <Card key={f.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{f.question}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{f.answer}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
