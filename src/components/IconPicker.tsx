import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ICONS } from "@/lib/icons";
import type { AccentColor } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { accentBg, accentText } from "@/lib/accent";

export const ACCENTS: AccentColor[] = ["green", "amber", "red", "blue", "violet", "teal"];

export function IconPicker({
  value,
  color,
  onChange,
  onColorChange,
}: {
  value: string;
  color: AccentColor;
  onChange: (key: string) => void;
  onColorChange: (color: AccentColor) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICONS;
    return ICONS.filter((i) => i.keywords.includes(q) || i.key.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj ikony: rabbit, clean, car, coffee…"
          className="h-11 rounded-xl pl-9"
        />
      </div>

      <div className="flex gap-2">
        {ACCENTS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onColorChange(c)}
            aria-label={`Kolor ${c}`}
            className={cn(
              "size-8 rounded-full transition-transform active:scale-90",
              accentBg(c),
              color === c && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
            )}
          />
        ))}
      </div>

      <div className="grid max-h-56 grid-cols-6 gap-2 overflow-y-auto rounded-2xl bg-muted/60 p-2">
        {results.map(({ key, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={key}
            className={cn(
              "flex aspect-square items-center justify-center rounded-xl bg-card transition-transform active:scale-90",
              value === key ? cn(accentBg(color), "text-white") : "text-muted-foreground",
            )}
          >
            <Icon className={cn("size-5", value === key && "text-white")} />
          </button>
        ))}
        {results.length === 0 && (
          <p className="col-span-6 py-6 text-center text-sm text-muted-foreground">
            Brak ikon dla „{query}”
          </p>
        )}
      </div>
      <p className={cn("text-xs", accentText(color))}>
        Wybrano: {value} · kolor {color}
      </p>
    </div>
  );
}
