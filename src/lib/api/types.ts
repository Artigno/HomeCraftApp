// TypeScript interfaces mirroring the Laravel API resources / DTOs.

export interface MaintenanceTask {
  id: string;
  name: string;
  icon: string; // lucide icon key
  color: AccentColor;
  frequency_days: number;
  last_done_at: string; // ISO date
  note?: string;
}

export interface MaintenanceLog {
  id: string;
  task_id: string;
  logged_at: string;
  note?: string;
}

export interface RecipeIngredient {
  name: string;
  amount: string;
}

export interface Recipe {
  id: string;
  tin_id?: string;
  title: string;
  tags: string[];
  prep_minutes: number;
  servings: number;
  emoji: string;
  ingredients: RecipeIngredient[];
  steps: string[];
}

/** GET/POST /recipes/imports — draft recipe scraped/structured from a
 * pasted external link, shape matches Recipe minus `id`/`tin_id`/`tags`. */
export interface RecipeImportDraft {
  title: string;
  emoji: string;
  ingredients: RecipeIngredient[];
  steps: string[];
  prep_minutes: number;
  servings: number;
}

export interface RecipeImportStatus {
  id: string;
  status: "pending" | "ready" | "failed";
  draft: RecipeImportDraft | null;
  error: string | null;
  updated_at: string;
}

export type TinShape = "round" | "rectangular";

export interface Tin {
  id: string;
  name: string;
  shape: TinShape;
  diameter_cm?: number;
  width_cm?: number;
  length_cm?: number;
  height_cm?: number;
  notes?: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  amount?: string;
  recipe_title?: string;
  done: boolean;
  /** days since the item was last purchased, if recently bought. The API
   * serializes an unset value as `null`, not an omitted key — never compare
   * against `undefined` alone when reading this field. */
  recent_purchase_days?: number | null;
  warning_dismissed: boolean;
  created_at: string;
  updated_at: string;
  sort_order: number;
}

export interface PurchaseLine {
  id?: number;
  name: string;
  price: number;
  qty?: number;
  unit_price?: number;
  shopping_item_id?: string | null;
  shopping_item_name?: string | null;
}

export interface ReceiptParseLine {
  name: string;
  price: number;
  shopping_item_id: string | null;
}

export interface ReceiptParseResult {
  store: string;
  category: string;
  total: number;
  purchased_at: string;
  lines: ReceiptParseLine[];
}

export interface Purchase {
  id: string;
  store: string;
  category: string;
  total: number;
  purchased_at: string;
  lines: PurchaseLine[];
  // Temporary S3 URL, expires 10 minutes after the backend generated it —
  // never cache/persist this field, always use whatever came with the
  // purchase on its most recent fetch.
  receipt_image_url?: string | null;
}

export interface HouseholdMember {
  id: number;
  name: string | null;
  is_owner: boolean;
  /** Owner sees every member's own code; a non-owner member sees only their
   * own (others are null). Also null for members who joined before this
   * shipped — no backfill, new data going forward only. */
  joined_with_code: string | null;
}

export interface Household {
  id: string;
  members: HouseholdMember[];
  share_code: string | null;
}

export interface JoinStatus {
  approved: boolean;
}

export interface PendingMember {
  id: number;
  name: string;
  requested_at: string;
  /** true when this pending entry came from the re-login path (an existing
   * member resubmitting their own joined_with_code) rather than a first-time
   * join. */
  is_returning: boolean;
}

export interface ActivityLogEntry {
  id: string;
  actor_name: string;
  action: "created" | "updated" | "deleted";
  subject_type: string;
  subject_label: string;
  created_at: string;
}

export interface ActivityPage {
  data: ActivityLogEntry[];
  meta: {
    current_page: number;
    last_page: number;
  };
}

export type AccentColor = "green" | "amber" | "red" | "blue" | "violet" | "teal";

export type TaskStatus = "good" | "warning" | "overdue";

/** GET /shopping-suggestions — server-computed restock candidates (bought
 * >2 times, due by avg interval, not on the active list, not in the
 * server's post-dismissal cooldown). Replaces the old client-side
 * computeSuggestion() heuristic entirely; the server owns dismissal state. */
export interface ShoppingSuggestion {
  id: number;
  name: string;
  purchase_count: number;
  last_purchased_at: string;
  avg_interval_days: number;
  days_since_last_purchase: number;
}

export interface NotificationPreferences {
  shopping_item_added: boolean;
  shopping_finished: boolean;
  habit_logged: boolean;
  recipe_added: boolean;
}

export interface HomeSyncState {
  tasks: MaintenanceTask[];
  logs: MaintenanceLog[];
  recipes: Recipe[];
  shopping: ShoppingItem[];
  purchases: Purchase[];
  tins: Tin[];
}
