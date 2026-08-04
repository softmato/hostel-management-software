"use client";

import { BadgePlus, ChevronDown, LayoutDashboard, LogOut, QrCode } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { checkAuthWithRefresh } from "@/lib/auth-check";
import { landingPathForRole } from "@/lib/route-access";
import { Role } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  ResidentIdentityCenter,
  requestResidentProfileForm,
  requestResidentQr,
} from "@/components/resident-identity";
import { ThemeToggle } from "@/components/theme-toggle";

type PublicHeaderProps = {
  active?:
    | "about"
    | "blog"
    | "browse"
    | "community"
    | "compare"
    | "contact"
    | "home"
    | "pricing"
    | "privacy"
    | "providers"
    | "register-hostel"
    | "terms";
};

type CurrentUser = {
  email: string | null;
  image: string | null;
  name: string;
  role: Role;
  /** Null until they save their resident profile for the first time. */
  userResidentId: string | null;
};

type MeResponse =
  | {
      data: {
        user: CurrentUser;
      };
      success: true;
    }
  | {
      message: string;
      success: false;
    };

const DASHBOARD_ROLES = new Set([
  Role.SUPERADMIN,
  Role.PLATFORM_MODERATOR,
  Role.HOSTEL_ADMIN,
  Role.WARDEN,
  Role.RESIDENT,
  Role.GUARDIAN,
]);

function hasDashboard(role: Role) {
  return DASHBOARD_ROLES.has(role);
}

function dashboardHrefForRole(role: Role) {
  return landingPathForRole(role) ?? "/";
}

const navItems = [
  { href: "/", id: "home", label: "Home" },
  { href: "/hostels", id: "browse", label: "Hostels" },
  // One community for the whole platform, reachable from every header rather
  // than buried in a portal sidebar — signed-out readers included.
  { href: "/community", id: "community", label: "Community" },
  { href: "/compare", id: "compare", label: "Compare" },
  { href: "/register-hostel", id: "register-hostel", label: "Register Hostel" },
  // Lands on the public directory; registering is the CTA on that page.
  { href: "/service-providers", id: "providers", label: "Service Providers" },
] as const;

const moreItems = [
  { href: "/blog", id: "blog", label: "Blog" },
  { href: "/about", id: "about", label: "About Us" },
  { href: "/contact", id: "contact", label: "Contact" },
  { href: "/terms", id: "terms", label: "Terms" },
  { href: "/privacy", id: "privacy", label: "Privacy Policy" },
] as const;

export function PublicHeader({ active }: PublicHeaderProps) {
  const router = useRouter();
  const [isSessionChecked, setIsSessionChecked] = useState(false);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadCurrentUser = useCallback(async () => {
    try {
      const response = await checkAuthWithRefresh();
      const payload = (await response.json().catch(() => null)) as MeResponse | null;

      if (!response.ok || !payload?.success) {
        setUser(null);
        return;
      }

      setUser(payload.data.user);
    } catch {
      setUser(null);
    } finally {
      setIsSessionChecked(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCurrentUser();
    }, 0);

    function handleFocus() {
      void loadCurrentUser();
    }

    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadCurrentUser]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 50);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function handleLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setMenuOpen(false);
    router.push("/");
  }

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 w-full transition-all duration-300",
        scrolled ? "bg-surface/80 backdrop-blur-lg" : "bg-transparent",
      )}
    >
      <div className="flex h-16 w-full items-center justify-between px-4 md:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 font-heading text-lg font-semibold text-brand-teal"
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-brand-teal text-sm font-bold text-white">
            H
          </span>
        </Link>

        <nav className="hidden h-full items-center gap-6 text-sm font-medium text-foreground md:flex">
          {navItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                "flex h-full items-center border-b-2 border-transparent pt-1 transition hover:text-brand-teal",
                active === item.id && "border-b-2 border-brand-teal text-brand-teal",
              )}
            >
              {item.label}
            </Link>
          ))}
          <div className="group relative flex h-full items-center">
            <button
              className={cn(
                "flex h-full items-center gap-1 border-b-2 border-transparent pt-1 transition hover:text-brand-teal",
                moreItems.some((i) => i.id === active) &&
                  "border-b-2 border-brand-teal text-brand-teal",
              )}
            >
              More
              <ChevronDown className="size-3.5 transition group-hover:rotate-180" />
            </button>
            <div className="absolute left-1/2 top-full mt-0 -translate-x-1/2 w-44 origin-top scale-95 rounded-lg border border-border bg-surface p-1.5 shadow-lg opacity-0 transition-all duration-150 pointer-events-none group-hover:scale-100 group-hover:opacity-100 group-hover:pointer-events-auto">
              {moreItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className={cn(
                    "block rounded-md px-3 py-2 text-sm text-foreground transition hover:bg-muted",
                    active === item.id && "bg-muted font-semibold",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden md:inline-flex" />
          {isSessionChecked ? (
            user ? (
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex items-center gap-2 rounded-full p-1 pr-3 text-sm font-semibold text-foreground transition-colors duration-200 bg-surface/70 backdrop-blur-md hover:bg-surface/85"
                >
                  {user.image ? (
                    <Image
                      src={user.image}
                      alt=""
                      width={32}
                      height={32}
                      className="size-8 rounded-full object-cover"
                      /*
                       * A resident's card photo is served from an authenticated
                       * route; the image optimizer fetches without their cookies
                       * and would only ever get a 401 back.
                       */
                      unoptimized
                    />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-full bg-brand-teal/10 text-sm font-semibold text-brand-teal">
                      {(user.name || user.email || "U").charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="hidden md:inline text-muted-foreground">
                    {user.name || user.email}
                  </span>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-border bg-surface p-1 shadow-lg">
                    <div className="border-b border-border px-3 py-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {user.name || user.email}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                    {hasDashboard(user.role) && (
                      <Link
                        href={dashboardHrefForRole(user.role)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition hover:bg-muted"
                      >
                        <LayoutDashboard className="size-4" />
                        Dashboard
                      </Link>
                    )}
                    {user.userResidentId ? (
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          requestResidentQr();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition hover:bg-muted"
                      >
                        <QrCode className="size-4" />
                        Resident ID card
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          requestResidentProfileForm("MANUAL");
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-brand-teal transition hover:bg-brand-teal/10"
                      >
                        <BadgePlus className="size-4" />
                        Create resident ID
                      </button>
                    )}
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
                    >
                      <LogOut className="size-4" />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className="rounded-lg px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
                >
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-110"
                >
                  Sign Up
                </Link>
              </div>
            )
          ) : (
            <span className="inline-flex h-10 w-28 rounded-lg bg-muted md:h-10 md:w-32" />
          )}
        </div>
      </div>

      {/* Mounted here because the header is the one shell on every public page,
          so any page can open the QR / profile modals via a window event.
          Deliberately NOT gated on `isSessionChecked` — it resolves sign-in
          state itself, and gating it meant the modal never opened while the
          session check was still in flight. */}
      <ResidentIdentityCenter onProfileSaved={loadCurrentUser} />
    </header>
  );
}
