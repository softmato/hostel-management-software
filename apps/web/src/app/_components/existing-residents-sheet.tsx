"use client";

import { AlertTriangle, CheckCircle2, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { useConfirm } from "@/app/_components/confirm-dialog";
import { cn } from "@/lib/utils";
import type { CheckResult, ListRow } from "@/modules/residents/existing-residents-check";
import {
  blankSheetRow,
  cleanCell,
  columnOfProblem,
  isBlankSheetRow,
  pasteIntoSheet,
  readSheet,
  rentStatusOptions,
  SHEET_COLUMNS,
  sheetFrom,
  type SheetColumn,
  type SheetOutRow,
  type SheetRow,
} from "@/modules/residents/existing-residents-sheet-model";

import { RoleButton } from "./portal-dashboard-ui";

/**
 * "Fill in sheet" — the Excel file's columns as a full-screen grid, for anyone
 * whose Excel won't type (docs/EXISTING_RESIDENTS.md). Arrow keys and Enter move
 * between cells, rows copied from any spreadsheet paste in, and saving writes
 * straight to the same list the page shows — no file to download and upload.
 */

type Props = {
  check: CheckResult | null;
  currentPeriod: string;
  hostelName: string;
  onClose: () => void;
  /** Saves the lines and returns the checked list. */
  onSave: (rows: SheetOutRow[]) => Promise<{ check: CheckResult | null; rows: ListRow[] }>;
  /** The list line to put the cursor on. */
  openAt?: string | null;
  roomTypes: string[];
  rows: ListRow[];
  tone: "admin" | "platform";
};

const cellInput =
  "block h-9 w-full min-w-0 truncate bg-transparent px-2 text-[13px] text-foreground outline-none focus:bg-background focus:ring-2 focus:ring-inset focus:ring-brand-teal read-only:text-muted-foreground [&>option]:bg-background [&>option]:text-foreground";

/** The line-number column; the pinned name column starts where it ends. */
const NUMBER_WIDTH = 48;
const SHEET_WIDTH = NUMBER_WIDTH + SHEET_COLUMNS.reduce((sum, column) => sum + column.width, 0);

function cellAt(row: number, column: number) {
  return document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-cell="${row}:${column}"]`);
}

function focusCell(row: number, column: number) {
  const cell = cellAt(row, column);

  cell?.focus();
  if (cell instanceof HTMLInputElement) cell.select();
}

export function ExistingResidentsSheet({
  check: firstCheck,
  currentPeriod,
  hostelName,
  onClose,
  onSave,
  openAt,
  roomTypes,
  rows: listRows,
  tone,
}: Props) {
  const { confirm, confirmDialog } = useConfirm();
  const [rows, setRows] = useState<SheetRow[]>(() => sheetFrom(listRows));
  const [check, setCheck] = useState(firstCheck);
  // Lines typed in since the last check — their old problems no longer apply.
  const [edited, setEdited] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState({ column: 0, row: 0 });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const overflow = document.body.style.overflow;
    const chosen = listRows.findIndex((row) => row.id === openAt);

    document.body.style.overflow = "hidden";
    // The line asked for, or the first empty line under the list.
    focusCell(chosen >= 0 ? chosen : listRows.length, 0);

    return () => {
      document.body.style.overflow = overflow;
    };
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const read = useMemo(() => readSheet(rows), [rows]);
  const cellErrors = useMemo(
    () => new Map(read.errors.map((error) => [`${error.key}:${error.column}`, error.message])),
    [read],
  );
  const problems = useMemo(() => new Map((check?.rows ?? []).map((row) => [row.id, row.problems])), [check]);

  const problemsOf = (row: SheetRow) =>
    row.id && !edited.has(row.key) && !isBlankSheetRow(row) ? (problems.get(row.id) ?? []) : [];
  const changed = edited.size > 0;
  const filled = rows.filter((row) => !isBlankSheetRow(row)).length;
  const withProblems = rows.filter((row) => problemsOf(row).length > 0).length;

  function setCell(key: string, column: SheetColumn, value: string) {
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, cells: { ...row.cells, [column]: cleanCell(column, value) } } : row,
      ),
    );
    setEdited((current) => (current.has(key) ? current : new Set(current).add(key)));
  }

  function move(row: number, column: number) {
    const nextColumn = Math.min(Math.max(column, 0), SHEET_COLUMNS.length - 1);
    const nextRow = Math.max(row, 0);

    if (nextRow >= rows.length) {
      setRows((current) => [...current, ...Array.from({ length: 10 }, blankSheetRow)]);
      requestAnimationFrame(() => focusCell(nextRow, nextColumn));

      return;
    }

    focusCell(nextRow, nextColumn);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const at = target.dataset.cell?.split(":").map(Number);

    if (!at) return;

    const [row, column] = at as [number, number];
    const text = target instanceof HTMLInputElement ? target : null;

    switch (event.key) {
      case "ArrowUp":
        move(row - 1, column);
        break;
      case "ArrowDown":
        // Alt+Down opens a dropdown cell, as it does in Excel.
        if (event.altKey && !text) return;
        move(row + 1, column);
        break;
      case "Enter":
        move(event.shiftKey ? row - 1 : row + 1, column);
        break;
      case "ArrowLeft":
        if (text && (text.selectionStart !== 0 || text.selectionEnd !== 0)) return;
        move(row, column - 1);
        break;
      case "ArrowRight":
        if (text && text.selectionEnd !== text.value.length) return;
        move(row, column + 1);
        break;
      case "Backspace":
      case "Delete": {
        // A dropdown box clears the way a typed box does.
        const line = rows[row];
        const key = SHEET_COLUMNS[column]?.key;

        if (text || !line || !key || line.residentId) return;
        setCell(line.key, key, "");
        break;
      }
      default:
        return;
    }

    event.preventDefault();
  }

  function onPaste(event: ClipboardEvent<HTMLTableElement>) {
    const target = event.target as HTMLElement;
    const at = target.dataset.cell?.split(":").map(Number);
    const text = event.clipboardData.getData("text/plain").replace(/\r?\n$/, "");

    // One plain value pastes into its box as usual; cells copied from a sheet spread out.
    if (!at || (!text.includes("\t") && !text.includes("\n"))) return;

    event.preventDefault();

    const [row, column] = at as [number, number];
    const next = pasteIntoSheet(rows, { column, row }, text, { currentPeriod, roomTypes });

    setRows(next);
    setEdited((current) => {
      const keys = new Set(current);

      next.forEach((line, index) => {
        if (line !== rows[index]) keys.add(line.key);
      });

      return keys;
    });
  }

  function removeLine(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
    setEdited((current) => new Set(current).add(key));
  }

  async function save(close: boolean) {
    const firstError = read.errors[0];

    if (firstError) {
      const row = rows.findIndex((line) => line.key === firstError.key);

      setMessage(`Line ${row + 1}: ${firstError.message}`);
      focusCell(row, SHEET_COLUMNS.findIndex((column) => column.key === firstError.column));

      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const result = await onSave(read.rows);

      if (close) {
        onClose();

        return;
      }

      setRows(sheetFrom(result.rows));
      setCheck(result.check);
      setEdited(new Set());
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    if (changed) {
      const ok = await confirm({
        actionLabel: "Close without saving",
        description: "What you typed in the sheet is not saved to the list.",
        title: "Close without saving?",
        tone: "destructive",
      });

      if (!ok) return;
    }

    onClose();
  }

  function nextProblem() {
    for (let step = 1; step <= rows.length; step += 1) {
      const index = (active.row + step) % rows.length;
      const found = problemsOf(rows[index]!)[0];

      if (found) {
        focusCell(index, SHEET_COLUMNS.findIndex((column) => column.key === columnOfProblem(found.field)));

        return;
      }
    }
  }

  const activeRow = rows[active.row];
  const activeError = activeRow ? cellErrors.get(`${activeRow.key}:${SHEET_COLUMNS[active.column]?.key}`) : undefined;
  const activeProblems = activeRow ? problemsOf(activeRow) : [];

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Residents sheet">
      {confirmDialog}

      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">Residents sheet · {hostelName}</p>
          <p className="text-xs text-muted-foreground">
            Works like Excel: arrow keys and Enter move between boxes. Copy rows from any sheet and paste them here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {withProblems ? (
            <RoleButton onClick={nextProblem} tone={tone} type="button" variant="outline">
              <AlertTriangle className="size-4 text-warning" />
              Next problem
            </RoleButton>
          ) : null}
          <RoleButton disabled={saving} onClick={() => void save(false)} tone={tone} type="button" variant="outline">
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save and check
          </RoleButton>
          <RoleButton disabled={saving} onClick={() => void save(true)} tone={tone} type="button">
            Save and close
          </RoleButton>
          <button
            aria-label="Close sheet"
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={() => void close()}
            type="button"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table
          className="w-full table-fixed border-separate border-spacing-0 text-left"
          style={{ minWidth: SHEET_WIDTH }}
          onFocus={(event) => {
            const at = (event.target as HTMLElement).dataset.cell?.split(":").map(Number);

            if (at) setActive({ column: at[1]!, row: at[0]! });
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        >
          <colgroup>
            <col style={{ width: NUMBER_WIDTH }} />
            {SHEET_COLUMNS.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
            {/* Takes whatever width is left, so the columns above keep theirs. */}
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-r border-border bg-muted px-2 py-2 text-[11px] font-semibold text-muted-foreground" />
              {SHEET_COLUMNS.map((column, index) => (
                <th
                  className={cn(
                    "sticky top-0 z-20 border-b border-r border-border bg-muted px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                    index === 0 && "left-12 z-30",
                    active.column === index && "text-brand-teal",
                  )}
                  key={column.key}
                >
                  <span className="block truncate">{column.label}</span>
                </th>
              ))}
              <th className="sticky top-0 z-20 border-b border-border bg-muted" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const added = Boolean(row.residentId);
              const lineProblems = problemsOf(row);
              const problemColumns = new Set(lineProblems.map((problem) => columnOfProblem(problem.field)));

              return (
                <tr className="group" key={row.key}>
                  <td
                    className={cn(
                      "sticky left-0 z-10 border-b border-r border-border bg-muted px-1 text-center text-[11px] text-muted-foreground",
                      active.row === rowIndex && "font-semibold text-brand-teal",
                    )}
                  >
                    <span className="group-hover:hidden">
                      {added ? <CheckCircle2 className="mx-auto size-3.5 text-success" /> : rowIndex + 1}
                    </span>
                    {added ? (
                      <span className="hidden group-hover:inline">{rowIndex + 1}</span>
                    ) : (
                      <button
                        aria-label={`Remove line ${rowIndex + 1}`}
                        className="mx-auto hidden text-muted-foreground hover:text-destructive group-hover:block"
                        onClick={() => removeLine(row.key)}
                        tabIndex={-1}
                        type="button"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </td>
                  {SHEET_COLUMNS.map((column, columnIndex) => {
                    const value = row.cells[column.key];
                    const flagged =
                      cellErrors.has(`${row.key}:${column.key}`) || problemColumns.has(column.key);
                    const cellProps = {
                      "aria-label": `${column.label}, line ${rowIndex + 1}`,
                      "data-cell": `${rowIndex}:${columnIndex}`,
                    };

                    let control;

                    if (added) {
                      const shown =
                        column.key === "paidTill"
                          ? (rentStatusOptions(currentPeriod, value || null).find((option) => option.value === value)
                              ?.label ?? "")
                          : value;

                      control = <input {...cellProps} className={cellInput} readOnly value={shown} />;
                    } else if (column.key === "roomType") {
                      control = (
                        <select
                          {...cellProps}
                          className={cellInput}
                          onChange={(event) => setCell(row.key, column.key, event.target.value)}
                          value={value}
                        >
                          <option disabled hidden value="" />
                          {value && !roomTypes.includes(value) ? <option value={value}>{value}</option> : null}
                          {roomTypes.map((room) => (
                            <option key={room} value={room}>
                              {room}
                            </option>
                          ))}
                        </select>
                      );
                    } else if (column.key === "paidTill") {
                      control = (
                        <select
                          {...cellProps}
                          className={cellInput}
                          onChange={(event) => setCell(row.key, column.key, event.target.value)}
                          value={value}
                        >
                          <option disabled hidden value="" />
                          {rentStatusOptions(currentPeriod, value || null).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      );
                    } else {
                      control = (
                        <input
                          {...cellProps}
                          className={cellInput}
                          inputMode={
                            column.key === "phone"
                              ? "tel"
                              : column.key === "email"
                                ? "email"
                                : column.key === "fullName"
                                  ? "text"
                                  : "numeric"
                          }
                          onChange={(event) => setCell(row.key, column.key, event.target.value)}
                          placeholder={rowIndex === 0 && column.key === "joinedDate" ? "2082-04-15" : undefined}
                          value={value}
                        />
                      );
                    }

                    return (
                      <td
                        className={cn(
                          "border-b border-r border-border bg-background p-0",
                          columnIndex === 0 && "sticky left-12 z-10",
                        )}
                        key={column.key}
                        title={cellErrors.get(`${row.key}:${column.key}`)}
                      >
                        {/* The tint sits inside, so the pinned name column stays solid when scrolled under. */}
                        <div className={cn(added && "bg-muted/50", flagged && "ring-1 ring-inset ring-warning")}>
                          {control}
                        </div>
                      </td>
                    );
                  })}
                  <td className="border-b border-border" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted/60 px-4 py-2 text-xs">
        <p className="min-w-0 flex-1 truncate">
          {message ? (
            <span className="text-destructive">{message}</span>
          ) : activeError ? (
            <span className="text-warning">
              Line {active.row + 1} · {activeError}
            </span>
          ) : activeProblems.length ? (
            <span className="text-warning">
              Line {active.row + 1} · {activeProblems.map((problem) => problem.message).join(" · ")}
            </span>
          ) : activeRow?.residentId ? (
            <span className="text-muted-foreground">Line {active.row + 1} · Already added as a resident</span>
          ) : (
            <span className="text-muted-foreground">
              Line {active.row + 1} · {SHEET_COLUMNS[active.column]?.label}
            </span>
          )}
        </p>
        <p className="text-muted-foreground">
          {filled} {filled === 1 ? "resident" : "residents"}
          {changed ? " · not saved" : withProblems ? ` · ${withProblems} need fixing` : ""}
        </p>
      </footer>
    </div>,
    document.body,
  );
}
