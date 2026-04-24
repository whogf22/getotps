import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

export default function ChangelogPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery<any[]>({ queryKey: ["/api/changelog"] });
  const readAll = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/changelog/read-all", {});
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/changelog"] });
    },
  });

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Changelog</h1>
          <Button size="sm" onClick={() => readAll.mutate()}>Mark all as read</Button>
        </div>
        {(data || []).map((entry) => (
          <Card key={entry.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {entry.title}
                <Badge variant="outline">{entry.type}</Badge>
                {!entry.is_read && <Badge>New</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{entry.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
