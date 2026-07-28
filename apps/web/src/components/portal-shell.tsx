"use client";

import {
  Activity,
  BedDouble,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesColumn,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Flag,
  FileText,
  Gift,
  Globe,
  HelpCircle,
  Home,
  LayoutDashboard,
  LayoutTemplate,
  MapPin,
  Megaphone,
  Menu,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  QrCode,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  Sparkles,
  Star,
  Tag,
  ToggleLeft,
  UserRound,
  Users,
  Utensils,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { HostelPreviewLink } from "@/components/hostel-preview-link";
import { PortalAccount } from "@/components/portal-account";
import { PortalSearch } from "@/components/portal-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  PortalIconName,
  PortalNavGroup,
  PortalNavItem,
  PortalNavLeaf,
  PortalSearchEntry,
} from "@/lib/portal-nav";
import { cn } from "@/lib/utils";

type PortalTone = "platform" | "admin" | "resident" | "guardian";

type PortalShellProps = {
  children: ReactNode;
  navGroups: PortalNavGroup[];
  portalName: string;
  searchEntries?: PortalSearchEntry[];
  searchPlaceholder?: string;
  subtitle: string;
  tone?: PortalTone;
  workspaceName?: string;
};

const iconMap: Record<PortalIconName, LucideIcon> = {
  activity: Activity,
  bed: BedDouble,
  bell: Bell,
  building: Building2,
  calendar: CalendarDays,
  card: CreditCard,
  chart: ChartNoAxesColumn,
  clipboard: ClipboardList,
  dashboard: LayoutDashboard,
  file: FileText,
  flag: Flag,
  food: Utensils,
  gift: Gift,
  globe: Globe,
  help: HelpCircle,
  layout: LayoutTemplate,
  map: MapPin,
  megaphone: Megaphone,
  message: MessageSquare,
  moon: Moon,
  qr: QrCode,
  receipt: ReceiptText,
  scroll: ScrollText,
  settings: Settings,
  shield: ShieldCheck,
  siren: Siren,
  sparkles: Sparkles,
  star: Star,
  tag: Tag,
  toggle: ToggleLeft,
  user: UserRound,
  users: Users,
  wrench: Wrench,
};

const toneStyles: Record<
  PortalTone,
  {
    active: string;
    badge: string;
    brand: string;
    brandSoft: string;
    hover: string;
    ring: string;
    softBg: string;
    text: string;
  }
> = {
  admin: {
    active: "bg-role-admin text-white shadow-sm",
    badge: "border-role-admin/20 bg-role-admin-soft text-role-admin",
    brand: "text-role-admin",
    brandSoft: "bg-role-admin",
    hover: "hover:bg-role-admin-soft/70 hover:text-role-admin",
    ring: "ring-role-admin/20",
    softBg: "bg-role-admin-soft",
    text: "text-role-admin",
  },
  guardian: {
    active: "bg-role-guardian text-white shadow-sm",
    badge: "border-role-guardian/20 bg-role-guardian-soft text-role-guardian",
    brand: "text-role-guardian",
    brandSoft: "bg-role-guardian",
    hover: "hover:bg-role-guardian-soft/70 hover:text-role-guardian",
    ring: "ring-role-guardian/20",
    softBg: "bg-role-guardian-soft",
    text: "text-role-guardian",
  },
  platform: {
    active: "bg-role-platform text-white shadow-sm",
    badge: "border-role-platform/20 bg-role-platform-soft text-role-platform",
    brand: "text-brand-teal",
    brandSoft: "bg-brand-teal",
    hover: "hover:bg-role-platform-soft/70 hover:text-role-platform",
    ring: "ring-role-platform/20",
    softBg: "bg-role-platform-soft",
    text: "text-role-platform",
  },
  resident: {
    active: "bg-role-resident text-white shadow-sm",
    badge: "border-role-resident/20 bg-role-resident-soft text-role-resident",
    brand: "text-role-resident",
    brandSoft: "bg-role-resident",
    hover: "hover:bg-role-resident-soft/70 hover:text-role-resident",
    ring: "ring-role-resident/20",
    softBg: "bg-role-resident-soft",
    text: "text-role-resident",
  },
};

const planCopy: Record<PortalTone, { cta: string; label: string; renews: string }> = {
  admin: { cta: "Manage Plan", label: "Premium", renews: "Valid till 25 Dec 2026" },
  guardian: {
    cta: "Contact Hostel",
    label: "Guardian Access",
    renews: "Linked resident view",
  },
  platform: {
    cta: "Manage Subscription",
    label: "Enterprise",
    renews: "Renews on Jul 25, 2026",
  },
  resident: { cta: "View Plan", label: "Standard", renews: "Valid till 10 Dec 2026" },
};

/**
 * Whether the viewport is at Tailwind's `md` breakpoint (768px) — the point
 * where the persistent sidebar takes over from the mobile drawer. Read via
 * `useSyncExternalStore` so the subscription lives outside React's render
 * cycle (no effect-driven setState) and SSR gets a stable false snapshot.
 */
function subscribeToDesktopBreakpoint(onChange: () => void) {
  const query = window.matchMedia("(min-width: 768px)");

  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getIsDesktopSnapshot() {
  return window.matchMedia("(min-width: 768px)").matches;
}

function getIsDesktopServerSnapshot() {
  return false;
}

export function PortalShell({
  children,
  navGroups,
  portalName,
  searchEntries = [],
  searchPlaceholder = "Search...",
  subtitle,
  tone = "platform",
  workspaceName,
}: PortalShellProps) {
  const pathname = usePathname();
  const styles = toneStyles[tone];
  const plan = planCopy[tone];
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navPathname, setNavPathname] = useState(pathname);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isDesktop = useSyncExternalStore(
    subscribeToDesktopBreakpoint,
    getIsDesktopSnapshot,
    getIsDesktopServerSnapshot,
  );

  // Close the mobile nav on navigation (state reset during render, per
  // react.dev "adjusting state when props change" — avoids an effect).
  if (navPathname !== pathname) {
    setNavPathname(pathname);
    setMobileNavOpen(false);
  }

  function handleNavToggle() {
    if (isDesktop) {
      setSidebarCollapsed((collapsed) => !collapsed);
    } else {
      setMobileNavOpen(true);
    }
  }

  function isActiveHref(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function hasActiveChild(item: PortalNavItem) {
    return (item.children ?? []).some((child) => isActiveHref(child.href));
  }

  const roleLabel = workspaceName ?? subtitle;

  function renderLeaf({
    child = false,
    collapsed = false,
    item,
    onNavigate,
  }: {
    child?: boolean;
    collapsed?: boolean;
    item: PortalNavLeaf;
    onNavigate?: () => void;
  }) {
    const Icon = iconMap[item.icon ?? "dashboard"];
    const isActive = isActiveHref(item.href);

    return (
      <Link
        className={cn(
          "flex min-h-0 items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[12.5px] font-medium text-slate-600 transition-colors dark:text-slate-300",
          styles.hover,
          isActive && styles.active,
          collapsed && "justify-center px-0",
          child && !collapsed && "py-1.5 pl-8 text-[12px]",
        )}
        href={item.href}
        key={item.href}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
      >
        {child ? null : (
          <Icon className="size-[15px] shrink-0" strokeWidth={isActive ? 2.3 : 1.9} />
        )}
        {collapsed ? null : (
          <>
            <span className="truncate">{item.label}</span>
            {item.badge && item.badge > 0 ? (
              <Badge
                className={cn(
                  "ml-auto h-[18px] min-w-[18px] rounded-full px-1.5 text-[10px] font-bold",
                  isActive
                    ? "border-white/20 bg-white/20 text-white"
                    : "border-transparent bg-role-resident text-white",
                )}
              >
                {item.badge}
              </Badge>
            ) : null}
          </>
        )}
      </Link>
    );
  }

  function renderItem(item: PortalNavItem, collapsed: boolean, onNavigate?: () => void) {
    const children = item.children ?? [];

    // In the collapsed rail there is no room for an accordion — the parent
    // becomes a plain link to its first destination.
    if (children.length === 0 || collapsed) {
      return renderLeaf({ collapsed, item, onNavigate });
    }

    const Icon = iconMap[item.icon ?? "dashboard"];
    const childActive = hasActiveChild(item);
    const isOpen = expanded[item.label] ?? childActive;

    return (
      <div key={item.label}>
        <button
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[12.5px] font-medium text-slate-600 transition-colors dark:text-slate-300",
            styles.hover,
            childActive && cn(styles.softBg, styles.text, "font-semibold"),
          )}
          onClick={() =>
            setExpanded((current) => ({ ...current, [item.label]: !isOpen }))
          }
          type="button"
        >
          <Icon className="size-[15px] shrink-0" strokeWidth={childActive ? 2.3 : 1.9} />
          <span className="truncate">{item.label}</span>
          <ChevronDown
            className={cn(
              "ml-auto size-3.5 shrink-0 transition-transform",
              isOpen && "rotate-180",
            )}
          />
        </button>

        {isOpen ? (
          <div className="relative mt-0.5 space-y-0.5">
            <span className="absolute bottom-1 left-[18px] top-1 w-px bg-border" />
            {children.map((child) =>
              renderLeaf({ child: true, item: child, onNavigate }),
            )}
          </div>
        ) : null}
      </div>
    );
  }

  function renderNav(onNavigate?: () => void, collapsed = false) {
    return (
      <nav className="flex flex-col gap-2.5 px-2 py-2.5">
        {navGroups.map((group, groupIndex) => (
          <div key={group.label ?? `group-${groupIndex}`}>
            {group.label && !collapsed ? (
              <p className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-muted-foreground">
                {group.label}
              </p>
            ) : null}
            {group.label && collapsed && groupIndex > 0 ? (
              <div className="mx-auto mb-2 h-px w-7 bg-border" />
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => renderItem(item, collapsed, onNavigate))}
            </div>
          </div>
        ))}
      </nav>
    );
  }

  function renderSidebarFooter(collapsed = false) {
    // The platform owner runs the product — a subscription upsell makes no
    // sense in their own admin, and the space is better given to the nav list.
    if (collapsed || tone === "platform") {
      return null;
    }

    return (
      <div className="space-y-2 border-t border-slate-100 p-2 dark:border-border">
        <div className="rounded-lg border border-slate-100 bg-white p-2 dark:border-border dark:bg-card">
          <p className="text-[10px] font-medium text-muted-foreground">Current Plan</p>
          <p className={cn("mt-0.5 text-[12.5px] font-bold", styles.text)}>{plan.label}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{plan.renews}</p>
          <Button
            className={cn(
              "mt-1.5 h-7 w-full rounded-md border text-[11px] font-semibold",
              styles.badge,
            )}
            type="button"
            variant="outline"
          >
            {plan.cta}
          </Button>
        </div>
      </div>
    );
  }

  function renderBrand(collapsed = false) {
    return (
      <Link
        className={cn("flex items-center gap-2.5", collapsed && "justify-center")}
        href="/"
        title={collapsed ? portalName : undefined}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm",
            styles.brandSoft,
          )}
        >
          <Home className="size-4 fill-white/20" />
        </span>
        {collapsed ? null : (
          <div className="min-w-0 leading-tight">
            <p
              className={cn(
                "font-heading text-[15px] font-bold tracking-tight",
                styles.brand,
              )}
            >
              {portalName}
            </p>
            <p className="truncate text-[10.5px] font-medium text-slate-500 dark:text-muted-foreground">
              {subtitle}
            </p>
          </div>
        )}
      </Link>
    );
  }

  return (
    /* Viewport-height frame: the brand rail, top bar, and copyright bar stay
       put while only the nav list and the content pane scroll. */
    <div className="flex h-screen flex-col overflow-hidden bg-[#f4f7fb] text-foreground dark:bg-background">
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "hidden shrink-0 flex-col border-r border-slate-200/80 bg-white transition-[width] duration-200 md:flex dark:border-border dark:bg-card",
            sidebarCollapsed ? "w-[68px]" : "w-[236px]",
          )}
        >
          <div className="shrink-0 border-b border-slate-100 px-3 py-2.5 dark:border-border">
            {renderBrand(sidebarCollapsed)}
          </div>

          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
            {renderNav(undefined, sidebarCollapsed)}
          </div>

          <div className="shrink-0">{renderSidebarFooter(sidebarCollapsed)}</div>
        </aside>

        <Sheet onOpenChange={setMobileNavOpen} open={mobileNavOpen}>
          <SheetContent className="flex w-[264px] flex-col gap-0 p-0 sm:max-w-[264px]" side="left">
            <SheetHeader className="shrink-0 border-b border-slate-100 px-3 py-3 dark:border-border">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {renderBrand()}
            </SheetHeader>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              {renderNav(() => setMobileNavOpen(false))}
            </div>
            <div className="shrink-0">{renderSidebarFooter()}</div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-slate-200/80 bg-white/95 backdrop-blur dark:border-border dark:bg-card/95">
            <div className="flex h-14 items-center gap-2.5 px-3 md:px-5">
              <Button
                aria-label={
                  isDesktop
                    ? sidebarCollapsed
                      ? "Expand navigation"
                      : "Collapse navigation"
                    : "Open navigation"
                }
                className="size-8 rounded-lg border-slate-200 bg-white text-slate-600 shadow-sm md:inline-flex"
                onClick={handleNavToggle}
                size="icon"
                type="button"
                variant="outline"
              >
                {isDesktop ? (
                  sidebarCollapsed ? (
                    <PanelLeftOpen className="size-4" />
                  ) : (
                    <PanelLeftClose className="size-4" />
                  )
                ) : (
                  <Menu className="size-4" />
                )}
              </Button>

              <PortalSearch
                className="hidden max-w-xl md:block"
                entries={searchEntries}
                placeholder={searchPlaceholder}
                tone={tone}
              />

              <div className="ml-auto flex items-center gap-1.5 md:gap-2">
                {tone === "admin" ? (
                  <HostelPreviewLink className="hidden lg:inline-flex" />
                ) : null}

                <ThemeToggle className="hidden size-8 sm:inline-flex" />

                <Button
                  aria-label="Notifications"
                  className="relative size-8 rounded-full border-slate-200 bg-white text-slate-600 shadow-sm dark:border-border dark:bg-card dark:text-foreground"
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Bell className="size-4" />
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-card">
                    3
                  </span>
                </Button>

                <Badge
                  className={cn(
                    "hidden h-auto items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:inline-flex",
                    styles.badge,
                  )}
                  variant="outline"
                >
                  {roleLabel}
                </Badge>

                <PortalAccount tone={tone} />
              </div>
            </div>

            <div className="border-t border-slate-100 px-3 py-2 md:hidden dark:border-border">
              <PortalSearch
                entries={searchEntries}
                placeholder={searchPlaceholder}
                tone={tone}
              />
            </div>
          </header>

          <main className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3.5 py-4 md:px-5 md:py-4">
            {children}
          </main>
        </div>
      </div>

      <footer className="shrink-0 border-t border-slate-200/80 bg-white px-4 py-2 text-[11px] text-slate-500 dark:border-border dark:bg-card dark:text-muted-foreground md:px-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 HostelHub Platform. All rights reserved.</p>
          <div className="flex items-center gap-4">
            {/* Support moved out of the sidebar card — same entry point, but it
                sits beside the credit instead of eating nav space. */}
            {tone !== "platform" && (
              <button
                className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-foreground dark:text-muted-foreground"
                type="button"
              >
                <HelpCircle className="size-3" />
                {tone === "guardian" ? "Contact Hostel" : "Help & Support"}
              </button>
            )}
            <p>
              Made with <span className="text-rose-500">♥</span> in Nepal 🇳🇵
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export type { PortalTone };
