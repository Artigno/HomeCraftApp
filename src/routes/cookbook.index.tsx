import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Clock, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useHomeSync } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cookbook/")({
  head: () => ({
    meta: [
      { title: "Przepisy — HomeSync" },
      {
        name: "description",
        content: "Kolekcja przepisów z szybkimi filtrami i dodawaniem składników do listy zakupów.",
      },
      { property: "og:title", content: "Przepisy — HomeSync" },
      {
        property: "og:description",
        content: "Przepisy domowe z jednym tapnięciem do listy zakupów.",
      },
    ],
  }),
  component: CookbookList,
});

function CookbookList() {
  const { recipes } = useHomeSync();
  const [filter, setFilter] = useState<string>("Wszystkie");

  const tags = useMemo(
    () => ["Wszystkie", ...Array.from(new Set(recipes.flatMap((r) => r.tags)))],
    [recipes],
  );
  const visible = filter === "Wszystkie" ? recipes : recipes.filter((r) => r.tags.includes(filter));

  return (
    <div>
      <PageHeader title="Przepisy" subtitle={`${recipes.length} dań w kolekcji`} />

      <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition-transform active:scale-95",
              filter === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 px-4">
        {visible.map((r) => (
          <Link
            key={r.id}
            to="/cookbook/$recipeId"
            params={{ recipeId: r.id }}
            className="card-soft flex flex-col gap-2 rounded-3xl bg-card p-4 transition-transform active:scale-[0.97]"
          >
            <span className="text-4xl">{r.emoji}</span>
            <p className="text-[15px] font-semibold leading-tight">{r.title}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" />
                {r.prep_minutes} min
              </span>
              <span className="flex items-center gap-1">
                <Users className="size-3.5" />
                {r.servings}
              </span>
            </div>
          </Link>
        ))}
      </div>
      <div className="h-6" />
    </div>
  );
}
