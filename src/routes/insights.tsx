import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Budżet — HomeSync" },
      { name: "description", content: "Analiza wydatków na zakupy." },
      { property: "og:title", content: "Budżet — HomeSync" },
      { property: "og:description", content: "Analiza wydatków na zakupy." },
    ],
  }),
  component: Insights,
});

function Insights() {
  return (
    <div>
      <PageHeader title="Budżet" subtitle="Wkrótce" />
      <p className="px-4 pt-6 text-sm text-muted-foreground">
        Analiza wydatków pojawi się tutaj wkrótce.
      </p>
    </div>
  );
}
