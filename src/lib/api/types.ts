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
  title: string;
  tags: string[];
  prep_minutes: number;
  servings: number;
  emoji: string;
  ingredients: RecipeIngredient[];
  steps: string[];
}

export interface ShoppingItem {
  id: string;
  name: string;
  amount?: string;
  recipe_title?: string;
  done: boolean;
  /** days since the item was last purchased, if recently bought */
  recent_purchase_days?: number;
  warning_dismissed: boolean;
  created_at: string;
}

export interface PurchaseLine {
  name: string;
  price: number;
}

export interface Purchase {
  id: string;
  store: string;
  category: string;
  total: number;
  purchased_at: string;
  lines: PurchaseLine[];
}

export type AccentColor = "green" | "amber" | "red" | "blue" | "violet" | "teal";

export type TaskStatus = "good" | "warning" | "overdue";

export interface HomeSyncState {
  tasks: MaintenanceTask[];
  logs: MaintenanceLog[];
  recipes: Recipe[];
  shopping: ShoppingItem[];
  purchases: Purchase[];
  dismissed_suggestions: string[];
}
