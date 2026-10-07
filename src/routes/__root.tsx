import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { LayoutGrid, ChefHat, ShoppingCart, PieChart } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { HomeSyncProvider } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";
import { cn } from "@/lib/utils";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

const PUBLIC_ROUTES = new Set(["/login", "/join", "/waitroom", "/auth/callback"]);

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Auth is gated client-side only (see RootComponent's effect below), never in
  // beforeLoad: the GH Pages static build prerenders a single shell reused for
  // every path (spa mode + 404.html fallback), so a beforeLoad redirect here
  // would bake one path's logged-out/in guess into that shared shell and fight
  // the client router's own re-matching on hydration — that's what caused the
  // /login redirect loop.
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1",
      },
      { title: "HomeSync — dom, zakupy i przepisy" },
      {
        name: "description",
        content:
          "Szybka aplikacja do obsługi domu: konserwacja, lista zakupów, przepisy i budżet gospodarstwa.",
      },
      { name: "theme-color", content: "#f8fafc" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "HomeSync" },
      { property: "og:title", content: "HomeSync" },
      { property: "og:description", content: "Dom, zakupy i przepisy w jednym miejscu." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Base-relative, not "/…" — must resolve under the GH Pages subpath too.
      { rel: "manifest", href: `${import.meta.env.BASE_URL}manifest.webmanifest` },
      { rel: "icon", href: `${import.meta.env.BASE_URL}favicon.ico`, type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const TABS = [
  { to: "/shopping", label: "Zakupy", Icon: ShoppingCart },
  { to: "/cookbook", label: "Przepisy", Icon: ChefHat },
  { to: "/", label: "Dom", Icon: LayoutGrid },
  { to: "/insights", label: "Budżet", Icon: PieChart },
] as const;

function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/85 pb-safe backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg items-stretch">
        {TABS.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors active:scale-95"
            activeProps={{ className: "text-foreground" }}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // sw.js calls skipWaiting()/clientsClaim() unconditionally, so a new
    // version takes control of already-open tabs without waiting for them
    // to close — but their JS bundle, already loaded in memory, stays old
    // until a reload. Surface that as a dismissible prompt rather than
    // reloading automatically, since an unprompted reload could interrupt
    // whatever the user is mid-typing (e.g. editing a shopping item).
    // clientsClaim() makes a brand-new SW take control of this very first
    // load too, firing "controllerchange" even though there's no older
    // version to prompt about — only show the toast when a controller was
    // already active before this run (i.e. a genuine update, not first install).
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded || !hadController) return;
      toast("Dostępna nowa wersja aplikacji", {
        duration: Infinity,
        action: {
          label: "Odśwież",
          onClick: () => {
            reloaded = true;
            window.location.reload();
          },
        },
      });
    });
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  }, []);

  // Client-only auth guard — see the note on beforeLoad above for why this
  // can't live in the router's own lifecycle for this static-shell build.
  useEffect(() => {
    const authed = isAuthenticated();
    if (!isPublicRoute && !authed) {
      void router.navigate({ to: "/login", replace: true });
    } else if (pathname === "/login" && authed) {
      void router.navigate({ to: "/", replace: true });
    }
  }, [pathname, isPublicRoute, router]);

  // client.ts dispatches this on a 401 instead of doing a hard reload, which
  // would interrupt React's in-flight hydration of the SSR-streamed shell.
  useEffect(() => {
    const onUnauthorized = () => void router.navigate({ to: "/login", replace: true });
    window.addEventListener("homesync:unauthorized", onUnauthorized);
    return () => window.removeEventListener("homesync:unauthorized", onUnauthorized);
  }, [router]);

  // client.ts dispatches this whenever a household-scoped request 403s with
  // household_approval_pending — covers a resumed session that's still
  // pending, not just the moment right after /join (which already
  // navigates here directly).
  useEffect(() => {
    const onPending = () => {
      if (pathname !== "/waitroom") void router.navigate({ to: "/waitroom", replace: true });
    };
    window.addEventListener("homesync:pending", onPending);
    return () => window.removeEventListener("homesync:pending", onPending);
  }, [router, pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      <HomeSyncProvider>
        <div
          className={cn("mx-auto min-h-screen max-w-lg bg-background", !isPublicRoute && "pb-24")}
        >
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </div>
        {!isPublicRoute && <TabBar />}
        <Toaster position="top-center" />
      </HomeSyncProvider>
    </QueryClientProvider>
  );
}
