import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  ChevronDown,
  GripVertical,
  Loader2,
  MoreVertical,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { ReceiptCheckoutModal } from "@/components/ReceiptCheckoutModal";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useSwipeToDelete } from "@/hooks/use-swipe-to-delete";
import { apiDismissShoppingSuggestion, apiGetShoppingSuggestions } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useHomeSync } from "@/lib/store";
import type { ShoppingItem, ShoppingSuggestion } from "@/lib/api/types";

export const Route = createFileRoute("/shopping")({
  head: () => ({
    meta: [
      { title: "Zakupy — HomeSync" },
      { name: "description", content: "Lista zakupów z szybkim dodawaniem i ostrzeżeniami." },
      { property: "og:title", content: "Zakupy — HomeSync" },
      { property: "og:description", content: "Szybka lista zakupów dla domu." },
    ],
  }),
  component: ShoppingList,
});

function ShoppingList() {
  const {
    shopping,
    addShoppingItems,
    daysSincePurchase,
    updateShoppingItem,
    categorizeShoppingItems,
    discardCompletedShoppingItems,
  } = useHomeSync();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [categorizing, setCategorizing] = useState(false);

  // Server-owned now (GET /shopping-suggestions): bought >2 times, due by
  // avg interval, not already on the list, not in the server's post-dismiss
  // cooldown. At most one shown at a time, same as the old client heuristic.
  const [suggestions, setSuggestions] = useState<ShoppingSuggestion[]>([]);
  useEffect(() => {
    let cancelled = false;
    void apiGetShoppingSuggestions().then((res) => {
      if (!cancelled && res.ok) setSuggestions(res.items);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const suggestion = suggestions[0];

  async function handleDismissSuggestion(s: ShoppingSuggestion) {
    setSuggestions((prev) => prev.filter((i) => i.id !== s.id));
    const res = await apiDismissShoppingSuggestion(s.id);
    if (!res.ok) setSuggestions((prev) => [s, ...prev]); // roll back optimistic dismiss
  }

  // Grouping is done/pending split via the accordion below, not an
  // automatic done-to-bottom sort within one flat list. `sorted` here only
  // ever holds pending items — done items render separately in the
  // collapsed-by-default accordion, un-draggable. toggleShoppingItem still
  // moves an item's sort_order to the end of its new group on toggle, so
  // the freeze mechanism right below is still needed.
  const sorted = useMemo(
    () => [...shopping].filter((i) => !i.done).sort((a, b) => a.sort_order - b.sort_order),
    [shopping],
  );

  const doneSorted = useMemo(
    () => [...shopping].filter((i) => i.done).sort((a, b) => a.sort_order - b.sort_order),
    [shopping],
  );

  const [doneExpanded, setDoneExpanded] = useState(false);

  // Freeze the rendered order briefly after a toggle so a fast second tap
  // lands on the item the user is looking at, not one that just slid up to
  // take its place — the toggle itself still applies instantly (checkbox
  // state), only the visual reflow is delayed. Same mechanism, duplicated
  // for the done group below — unchecking a done item reflows the
  // remaining done rows exactly the way toggling a pending item does.
  const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
  const freezeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function freezeOrderBriefly() {
    if (frozenOrder === null) {
      setFrozenOrder(sorted.map((i) => i.id));
    }
    if (freezeTimer.current) clearTimeout(freezeTimer.current);
    freezeTimer.current = setTimeout(() => setFrozenOrder(null), 400);
  }

  const [doneFrozenOrder, setDoneFrozenOrder] = useState<string[] | null>(null);
  const doneFreezeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function freezeDoneOrderBriefly() {
    if (doneFrozenOrder === null) {
      setDoneFrozenOrder(doneSorted.map((i) => i.id));
    }
    if (doneFreezeTimer.current) clearTimeout(doneFreezeTimer.current);
    doneFreezeTimer.current = setTimeout(() => setDoneFrozenOrder(null), 400);
  }

  useEffect(() => {
    return () => {
      if (freezeTimer.current) clearTimeout(freezeTimer.current);
      if (doneFreezeTimer.current) clearTimeout(doneFreezeTimer.current);
    };
  }, []);

  const displayOrder = useMemo(() => {
    if (!frozenOrder) return sorted;
    const byId = new Map(shopping.map((i) => [i.id, i]));
    return frozenOrder.map((id) => byId.get(id)).filter((i): i is ShoppingItem => i !== undefined);
  }, [frozenOrder, sorted, shopping]);

  const doneDisplayOrder = useMemo(() => {
    if (!doneFrozenOrder) return doneSorted;
    const byId = new Map(shopping.map((i) => [i.id, i]));
    return doneFrozenOrder
      .map((id) => byId.get(id))
      .filter((i): i is ShoppingItem => i !== undefined);
  }, [doneFrozenOrder, doneSorted, shopping]);

  const sensors = useSensors(
    // tolerance bumped from the plan's original 5px — real finger tremor
    // during a held-still 400ms press easily exceeds 5px and was silently
    // cancelling activation before the delay ever completed.
    useSensor(PointerSensor, { activationConstraint: { delay: 400, tolerance: 10 } }),
    // Keyboard-only path: focus a row (its <li> is already tabIndex 0 via
    // useSortable's own `attributes`), Space to pick up, arrow keys to
    // move, Space/Enter to drop — dnd-kit's standard accessible pattern.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeItem = activeId ? (displayOrder.find((i) => i.id === activeId) ?? null) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = displayOrder.findIndex((i) => i.id === active.id);
    const newIndex = displayOrder.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(displayOrder, oldIndex, newIndex);
    // No reindex/collision logic on the backend — renumber sequentially and
    // PATCH only the ids whose sort_order actually changed (typically the
    // contiguous range between the source and destination index).
    reordered.forEach((item, index) => {
      if (item.sort_order !== index) updateShoppingItem(item.id, { sort_order: index });
    });
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  const pending = shopping.filter((i) => !i.done).length;

  async function handleCategorize() {
    setCategorizing(true);
    const ok = await categorizeShoppingItems();
    setCategorizing(false);
    if (ok) {
      toast.success("Lista posortowana wg kategorii");
    } else {
      toast.error("Nie udało się skategoryzować listy. Spróbuj ponownie.");
    }
  }

  function addByName(rawName: string) {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    const recentDays = daysSincePurchase(trimmed);
    addShoppingItems([
      {
        name: trimmed,
        warning_dismissed: false,
        ...(recentDays !== undefined ? { recent_purchase_days: recentDays } : {}),
      },
    ]);
  }

  return (
    <div>
      <PageHeader
        title="Zakupy"
        subtitle={
          pending > 0
            ? `${pending} rzeczy do kupienia`
            : shopping.length > 0
              ? "Wszystko zaznaczone ✅"
              : "Lista jest pusta"
        }
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Więcej akcji"
                disabled={categorizing}
                className="-m-2 flex size-9 shrink-0 items-center justify-center rounded-full text-foreground active:scale-90 disabled:opacity-50"
              >
                {categorizing ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <MoreVertical className="size-5" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={pending < 2} onSelect={handleCategorize}>
                <Sparkles className="size-4" />
                Kategoryzuj AI
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!shopping.some((i) => i.done)}
                onSelect={() => setCheckoutOpen(true)}
              >
                Zakończ zakupy
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!shopping.some((i) => i.done)}
                className="text-destructive"
                onSelect={() => {
                  if (window.confirm("Usunąć zaznaczone produkty bez zapisu do budżetu?")) {
                    discardCompletedShoppingItems();
                  }
                }}
              >
                Wyczyść zaznaczone bez zapisu do budżetu
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {suggestion && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
          <p className="text-sm font-medium">Kończy się {suggestion.name}? Dodaj do listy</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              className="h-8 rounded-full px-3"
              onClick={() => {
                addByName(suggestion.name);
                void handleDismissSuggestion(suggestion);
              }}
            >
              Dodaj
            </Button>
            <button
              type="button"
              onClick={() => void handleDismissSuggestion(suggestion)}
              aria-label="Odrzuć sugestię"
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground active:scale-90"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <DndContext
        id="shopping-list-dnd"
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext
          items={displayOrder.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2 px-4 pb-3 pt-3">
            {displayOrder.map((item) => (
              <ShoppingListRow key={item.id} item={item} onToggleFreeze={freezeOrderBriefly} />
            ))}
            <AddItemRow onAdd={addByName} />
          </ul>
        </SortableContext>
        <DragOverlay>
          {activeItem && (
            <div className="scale-[1.03] rounded-2xl shadow-lg">
              <ShoppingListRowPreview item={activeItem} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {doneSorted.length > 0 && (
        <Collapsible open={doneExpanded} onOpenChange={setDoneExpanded} className="px-4 pb-3">
          <CollapsibleTrigger
            aria-expanded={doneExpanded}
            className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left text-sm font-medium text-muted-foreground"
          >
            Zakończone ({doneSorted.length})
            <ChevronDown
              className={cn("size-4 transition-transform", doneExpanded && "rotate-180")}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="space-y-2 pt-2">
              {doneDisplayOrder.map((item) => (
                <DoneShoppingListRow
                  key={item.id}
                  item={item}
                  onToggleFreeze={freezeDoneOrderBriefly}
                />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      <ReceiptCheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        boughtItems={shopping.filter((i) => i.done)}
      />
    </div>
  );
}

function AddItemRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setDraft("");
  }

  if (!active) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setActive(true)}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-border px-4 py-3 text-left text-muted-foreground transition-transform active:scale-[0.98]"
        >
          <Plus className="size-5" />
          <span className="text-[15px] font-medium">Dodaj produkt</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={() => {
          if (!draft.trim()) setActive(false);
        }}
        placeholder="Nazwa produktu"
        className="h-[52px] rounded-2xl px-4 text-[15px]"
      />
    </li>
  );
}

/** Static visual copy for DragOverlay — no event handlers, no
 * useSortable/useSwipeToDelete state, since a floating preview has no
 * meaning for either. */
function ShoppingListRowPreview({ item }: { item: ShoppingItem }) {
  return (
    <div className="card-soft flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-border/60">
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          item.done ? "border-primary bg-primary" : "border-muted-foreground/40",
        )}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[15px] font-medium",
            item.done && "text-muted-foreground line-through",
          )}
        >
          {item.name}
          {item.amount && (
            <span className="ml-1.5 text-sm text-muted-foreground">{item.amount}</span>
          )}
        </span>
        {item.recipe_title && (
          <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Przepis: {item.recipe_title}
          </span>
        )}
      </span>
      {typeof item.recent_purchase_days === "number" &&
        item.recent_purchase_days <= 7 &&
        !item.warning_dismissed && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--status-warning)]/14 px-2 py-1 text-[11px] font-semibold text-[var(--status-warning)]">
            kupiono {item.recent_purchase_days} dni temu
          </span>
        )}
    </div>
  );
}

function ShoppingListRow({
  item,
  onToggleFreeze,
}: {
  item: ShoppingItem;
  onToggleFreeze: () => void;
}) {
  const { toggleShoppingItem, removeShoppingItem, dismissWarning, updateShoppingItem } =
    useHomeSync();
  const {
    bind,
    style: swipeStyle,
    isRevealed,
    reset,
    consumeDragFlag,
    forceCancel,
  } = useSwipeToDelete({
    onDelete: () => removeShoppingItem(item.id),
  });
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: editing,
  });

  // If dnd-kit's long-press-drag activates while useSwipeToDelete was
  // already mid-tracking a horizontal read on the same gesture, the
  // composed pointer handlers below stop forwarding move/up/cancel to the
  // swipe hook (isDragging gate) — its internal dragging/captured refs
  // would otherwise stay stuck until the next pointerdown. Force a clean
  // handoff the moment a real drag wins.
  useEffect(() => {
    if (isDragging) forceCancel();
  }, [isDragging, forceCancel]);
  const [draftName, setDraftName] = useState(item.name);

  // Drag activation lives on a dedicated handle, not the whole row: a
  // long-press-to-drag with touch-action "none" spread over the entire
  // <li> blocked the browser's native vertical scroll for any touch that
  // started on an item (only the gaps between rows could scroll). Scoping
  // "none" to the handle button alone — dnd-kit's own documented
  // drag-handle pattern — leaves the rest of the row's touch-action at its
  // default, so the list scrolls normally from anywhere except the handle.
  // useSwipeToDelete's handlers stay on the row/card for the horizontal
  // swipe gesture; they're unaffected since the handle stops propagation.
  function handlePointerMove(e: React.PointerEvent<HTMLLIElement>) {
    if (!isDragging) bind.onPointerMove(e);
  }
  function handlePointerUp(e: React.PointerEvent<HTMLLIElement>) {
    if (!isDragging) bind.onPointerUp(e);
  }
  function handlePointerCancel(e: React.PointerEvent<HTMLLIElement>) {
    if (!isDragging) bind.onPointerCancel(e);
  }

  // dnd-kit's reflow transform (shifting every OTHER row to make room for
  // the one being dragged) must live on the <li> itself, not an inner
  // child — the <li> is also what carries overflow-hidden (needed to clip
  // the swipe-revealed delete panel), and a *child's* transform moving it
  // beyond its own unmoving parent's box gets clipped by that parent. That
  // was invisible for the dragged row (DragOverlay's floating copy hides
  // the problem) but very visible for every other row shifting to make
  // room — they'd clip away entirely, leaving only the delete panel (a
  // sibling, unaffected by the card's own transform) visible. Moving the
  // reflow transform onto the <li> means the whole row — clipping boundary
  // included — slides as one unit; nothing needs to escape its own box.
  // Swipe's horizontal translateX stays on the inner card only, since that
  // is specifically what reveals the delete panel sibling within the row.
  const liStyle: React.CSSProperties = {
    transform:
      `${CSS.Transform.toString(transform) ?? ""} ${isDragging ? "scale(0.95)" : ""}`.trim(),
    transition,
    ...(isDragging ? { opacity: 0.4 } : {}),
  };

  const showWarning =
    typeof item.recent_purchase_days === "number" &&
    item.recent_purchase_days <= 7 &&
    !item.warning_dismissed;

  /** Shared guard for the checkbox/label tap targets: a swipe-drag or an
   * already-revealed delete action should never also trigger toggle/edit. */
  function guardedTap(): boolean {
    if (consumeDragFlag()) return false;
    if (isRevealed) {
      reset();
      return false;
    }
    return true;
  }

  function startEdit() {
    if (!guardedTap()) return;
    setDraftName(item.name);
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== item.name) {
      updateShoppingItem(item.id, { name: trimmed });
    }
    setEditing(false);
  }

  return (
    <li
      ref={setNodeRef}
      onPointerDown={bind.onPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={liStyle}
      className="relative overflow-hidden rounded-2xl"
    >
      <div className="absolute inset-y-0 right-0 flex w-16 items-center justify-center rounded-2xl bg-[var(--accent-red)] text-white">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => removeShoppingItem(item.id)}
          aria-label="Usuń produkt"
          className="flex size-full items-center justify-center"
        >
          <Trash2 className="size-5" />
        </button>
      </div>

      <div
        style={swipeStyle}
        className="card-soft relative flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-border/60 transition-transform active:scale-[0.98]"
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Przesuń produkt"
          style={{ touchAction: "none" }}
          className="-m-2 flex shrink-0 cursor-grab touch-none items-center justify-center p-2 text-muted-foreground active:cursor-grabbing"
          onPointerDown={(e) => {
            listeners?.["onPointerDown"]?.(e);
            e.stopPropagation();
          }}
        >
          <GripVertical className="size-5" />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (guardedTap()) {
              onToggleFreeze();
              toggleShoppingItem(item.id);
            }
          }}
          aria-label={item.done ? "Odznacz produkt" : "Zaznacz produkt"}
          className="-m-2 flex shrink-0 items-center justify-center p-2"
        >
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border-2",
              item.done ? "border-primary bg-primary" : "border-muted-foreground/40",
            )}
          />
        </button>
        <span className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              onBlur={commitEdit}
              className="h-8 rounded-lg px-2 text-[15px]"
            />
          ) : (
            <span
              role="button"
              tabIndex={0}
              onClick={startEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  startEdit();
                }
              }}
              className="block w-full text-left"
            >
              <span
                className={cn(
                  "block text-[15px] font-medium",
                  item.done && "text-muted-foreground line-through",
                )}
              >
                {item.name}
                {item.amount && (
                  <span className="ml-1.5 text-sm text-muted-foreground">{item.amount}</span>
                )}
              </span>
            </span>
          )}
          {item.recipe_title && (
            <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Przepis: {item.recipe_title}
            </span>
          )}
        </span>

        {showWarning && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--status-warning)]/14 px-2 py-1 text-[11px] font-semibold text-[var(--status-warning)]">
            kupiono {item.recent_purchase_days} dni temu
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                removeShoppingItem(item.id);
              }}
              aria-label="Usuń produkt"
              className="flex size-4 items-center justify-center"
            >
              <Trash2 className="size-3" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                dismissWarning(item.id);
              }}
              className="flex items-center gap-0.5"
            >
              <Check className="size-3" /> Zatwierdź
            </button>
          </span>
        )}
      </div>
    </li>
  );
}

/** Done-item row: same checkbox/toggle, inline-name-edit, swipe-to-delete,
 * and warning-badge behavior as `ShoppingListRow`, but with no `useSortable`
 * call, no drag handle, and no drag-related styling — done items are never
 * part of the pending `SortableContext` and need none of that plumbing. */
function DoneShoppingListRow({
  item,
  onToggleFreeze,
}: {
  item: ShoppingItem;
  onToggleFreeze: () => void;
}) {
  const { toggleShoppingItem, removeShoppingItem, dismissWarning, updateShoppingItem } =
    useHomeSync();
  const {
    bind,
    style: swipeStyle,
    isRevealed,
    reset,
    consumeDragFlag,
  } = useSwipeToDelete({
    onDelete: () => removeShoppingItem(item.id),
  });
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(item.name);

  const showWarning =
    typeof item.recent_purchase_days === "number" &&
    item.recent_purchase_days <= 7 &&
    !item.warning_dismissed;

  function guardedTap(): boolean {
    if (consumeDragFlag()) return false;
    if (isRevealed) {
      reset();
      return false;
    }
    return true;
  }

  function startEdit() {
    if (!guardedTap()) return;
    setDraftName(item.name);
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== item.name) {
      updateShoppingItem(item.id, { name: trimmed });
    }
    setEditing(false);
  }

  return (
    <li
      onPointerDown={bind.onPointerDown}
      onPointerMove={bind.onPointerMove}
      onPointerUp={bind.onPointerUp}
      onPointerCancel={bind.onPointerCancel}
      className="relative overflow-hidden rounded-2xl"
    >
      <div className="absolute inset-y-0 right-0 flex w-16 items-center justify-center rounded-2xl bg-[var(--accent-red)] text-white">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => removeShoppingItem(item.id)}
          aria-label="Usuń produkt"
          className="flex size-full items-center justify-center"
        >
          <Trash2 className="size-5" />
        </button>
      </div>

      <div
        style={swipeStyle}
        className="card-soft relative flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-border/60 transition-transform active:scale-[0.98]"
      >
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (guardedTap()) {
              onToggleFreeze();
              toggleShoppingItem(item.id);
            }
          }}
          aria-label={item.done ? "Odznacz produkt" : "Zaznacz produkt"}
          className="-m-2 flex shrink-0 items-center justify-center p-2"
        >
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border-2",
              item.done ? "border-primary bg-primary" : "border-muted-foreground/40",
            )}
          />
        </button>
        <span className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              onBlur={commitEdit}
              className="h-8 rounded-lg px-2 text-[15px]"
            />
          ) : (
            <span
              role="button"
              tabIndex={0}
              onClick={startEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  startEdit();
                }
              }}
              className="block w-full text-left"
            >
              <span
                className={cn(
                  "block text-[15px] font-medium",
                  item.done && "text-muted-foreground line-through",
                )}
              >
                {item.name}
                {item.amount && (
                  <span className="ml-1.5 text-sm text-muted-foreground">{item.amount}</span>
                )}
              </span>
            </span>
          )}
          {item.recipe_title && (
            <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Przepis: {item.recipe_title}
            </span>
          )}
        </span>

        {showWarning && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--status-warning)]/14 px-2 py-1 text-[11px] font-semibold text-[var(--status-warning)]">
            kupiono {item.recent_purchase_days} dni temu
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                removeShoppingItem(item.id);
              }}
              aria-label="Usuń produkt"
              className="flex size-4 items-center justify-center"
            >
              <Trash2 className="size-3" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                dismissWarning(item.id);
              }}
              className="flex items-center gap-0.5"
            >
              <Check className="size-3" /> Zatwierdź
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
