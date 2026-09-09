"use client";

import { Loader2, Plus, Send, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { browserApi } from "@/lib/browser-api";
import { cn } from "@/lib/utils";

/**
 * The superadmin's Team tab.
 *
 * Answers the two questions the notes ask of it, in that order: who is on the
 * field team, and — for every hostel any of them registered — how much was paid,
 * by which method, and when.
 *
 * ## Invitations go out in batches
 *
 * A field team is hired in groups, so the invite box takes a list of addresses
 * rather than one. Sending is not all-or-nothing: each address reports its own
 * outcome, because a batch of ten where the fourth is already a resident should
 * send the other nine rather than refusing the lot and making somebody find the
 * bad row by hand.
 *
 * ## Cash has its own column, everywhere
 *
 * The same reason as on the agent's own desk: a Fonepay payment went to the
 * platform's merchant account and never touched the agent, so folding it into
 * one "collected" figure would overstate what any individual is answerable for.
 */

type Member = {
  cashCollected: number;
  email: string;
  hostelsRegistered: number;
  id: string;
  joinedAt: string | null;
  name: string;
  phone: string;
  status: string;
};

type Registration = {
  agentEmail: string;
  agentName: string;
  cashCollected: number;
  dueBy: string | null;
  hostelId: string;
  hostelName: string;
  hostelStatus: string;
  invoiceNumber: string;
  onlineCollected: number;
  outstanding: number;
  paid: number;
  planName: string;
  price: number;
  registeredAt: string | null;
  subscriptionStatus: string;
};

type InviteResult = {
  delivered: boolean;
  email: string;
  error: string | null;
  sent: boolean;
};

function rupees(amount: number) {
  return `Rs ${amount.toLocaleString("en-IN")}`;
}

function shortDate(iso: string | null) {
  if (!iso) {
    return "—";
  }

  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function InviteBox({ onSent }: { onSent: () => void }) {
  const [rows, setRows] = useState([{ email: "", id: crypto.randomUUID(), name: "" }]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [error, setError] = useState("");

  async function send() {
    const invitations = rows
      .filter((row) => row.email.trim())
      .map((row) => ({
        email: row.email.trim(),
        ...(row.name.trim() ? { name: row.name.trim() } : {}),
      }));

    if (invitations.length === 0) {
      setError("Add at least one address.");

      return;
    }

    setSending(true);
    setError("");

    try {
      const result = await browserApi<{ results: InviteResult[] }>(
        "/api/v1/platform/admins/invites",
        {
          body: JSON.stringify({ invitations, role: "PLATFORM_AGENT" }),
          method: "POST",
        },
      );

      setResults(result.results);
      setRows([{ email: "", id: crypto.randomUUID(), name: "" }]);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the invitations.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app-card p-5">
      <h2 className="text-sm font-bold text-foreground">Invite team members</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        They accept the emailed link, then sign in with Google on that address
        at <code className="rounded bg-muted px-1">/team</code>.
      </p>

      <div className="mt-4 space-y-2">
        {rows.map((row, index) => (
          <div className="flex gap-2" key={row.id}>
            <input
              aria-label={`Email ${index + 1}`}
              className="input-field flex-1"
              onChange={(event) =>
                setRows((prev) =>
                  prev.map((entry) =>
                    entry.id === row.id
                      ? { ...entry, email: event.target.value }
                      : entry,
                  ),
                )
              }
              placeholder="name@example.com"
              type="email"
              value={row.email}
            />
            <input
              aria-label={`Name ${index + 1}`}
              className="input-field w-40"
              onChange={(event) =>
                setRows((prev) =>
                  prev.map((entry) =>
                    entry.id === row.id ? { ...entry, name: event.target.value } : entry,
                  ),
                )
              }
              placeholder="Name (optional)"
              value={row.name}
            />
            {rows.length > 1 ? (
              <button
                aria-label="Remove"
                className="rounded-lg border border-border p-2.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                onClick={() =>
                  setRows((prev) => prev.filter((entry) => entry.id !== row.id))
                }
                type="button"
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-teal hover:underline"
          onClick={() =>
            setRows((prev) => [...prev, { email: "", id: crypto.randomUUID(), name: "" }])
          }
          type="button"
        >
          <Plus className="size-3.5" /> Add another
        </button>

        <button
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          disabled={sending}
          onClick={send}
          type="button"
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Send invitations
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-xs font-medium text-destructive">{error}</p>
      ) : null}

      {results ? (
        <ul className="mt-3 space-y-1 text-xs">
          {results.map((result) => (
            <li
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2",
                result.sent
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive",
              )}
              key={result.email}
            >
              <span className="font-semibold">{result.email}</span>
              <span>
                {result.sent
                  ? result.delivered
                    ? "Invitation sent"
                    : "Created, but the email did not send"
                  : result.error}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PlatformTeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const result = await browserApi<{
        members: Member[];
        registrations: Registration[];
      }>("/api/v1/platform/team");

      setMembers(result.members);
      setRegistrations(result.registrations);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The field team, and every hostel they have registered.
        </p>
      </div>

      <InviteBox onSent={load} />

      <div className="app-card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-bold text-foreground">
            Members{members.length > 0 ? ` (${members.length})` : ""}
          </h2>
        </div>

        {loading ? (
          <div className="space-y-2 p-5">
            {[0, 1].map((row) => (
              <div className="h-9 animate-pulse rounded bg-muted" key={row} />
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="mx-auto size-7 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">
              Nobody has accepted a team invitation yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Member", "Hostels", "Cash collected", "Joined", "Status"].map(
                    (heading) => (
                      <th
                        className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        key={heading}
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {member.hostelsRegistered}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums text-foreground">
                      {rupees(member.cashCollected)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {shortDate(member.joinedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold",
                          member.status === "ACTIVE"
                            ? "bg-success/10 text-success"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {member.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="app-card overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-bold text-foreground">Registrations by the team</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Who registered what, what it cost, what was collected and how.
          </p>
        </div>

        {registrations.length === 0 && !loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No hostels have been registered by the team yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {[
                    "Hostel",
                    "Registered by",
                    "Plan",
                    "Price",
                    "Cash",
                    "Online",
                    "Outstanding",
                    "When",
                  ].map((heading) => (
                    <th
                      className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      key={heading}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {registrations.map((row) => (
                  <tr key={row.hostelId}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{row.hostelName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.invoiceNumber}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-foreground">{row.agentName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.planName}</td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {rupees(row.price)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {row.cashCollected > 0 ? rupees(row.cashCollected) : "—"}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-foreground">
                      {row.onlineCollected > 0 ? rupees(row.onlineCollected) : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 font-semibold tabular-nums",
                        row.outstanding > 0 ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {row.outstanding > 0 ? rupees(row.outstanding) : "—"}
                      {row.outstanding > 0 && row.dueBy ? (
                        <span className="block text-[11px] font-normal">
                          due {shortDate(row.dueBy)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {shortDate(row.registeredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
