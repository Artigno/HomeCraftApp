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
  name: string;
  price: number;
  shopping_item_id?: string | null;
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
}

export interface HouseholdMember {
  id: number;
  name: string | null;
  is_owner: boolean;
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

export interface HomeSyncState {
  tasks: MaintenanceTask[];
  logs: MaintenanceLog[];
  recipes: Recipe[];
  shopping: ShoppingItem[];
  purchases: Purchase[];
  tins: Tin[];
}
