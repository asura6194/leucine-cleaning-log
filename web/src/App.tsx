import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CleaningRecordDTO,
  CleaningStatus,
  EquipmentDTO,
  PageInfo,
  UserDTO,
} from '../../shared/contract.ts';
import {
  DEFAULT_PAGE_SIZE,
  EQUIPMENT_MANAGER_ROLES,
  VERIFIER_ROLES,
} from '../../shared/contract.ts';
import { ApiError, api } from './api/client.ts';
import { formatDateTime } from './api/format.ts';
import { AuditTrailPanel, type AuditSubject } from './components/AuditTrailPanel.tsx';
import { EquipmentFormDialog } from './components/EquipmentFormDialog.tsx';
import { EquipmentSidebar } from './components/EquipmentSidebar.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { RecordFormDialog } from './components/RecordFormDialog.tsx';
import { RecordsTable } from './components/RecordsTable.tsx';
import { ErrorBox, Spinner } from './components/ui.tsx';

export function App() {
  /* session */
  const [user, setUser] = useState<UserDTO | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  /* reference data */
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [equipment, setEquipment] = useState<EquipmentDTO[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [equipmentError, setEquipmentError] = useState<unknown>(null);
  const [selected, setSelected] = useState<EquipmentDTO | null>(null);

  /* records for the selected asset */
  const [records, setRecords] = useState<CleaningRecordDTO[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<unknown>(null);
  const [filter, setFilter] = useState<CleaningStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  /* transient UI */
  const [editing, setEditing] = useState<CleaningRecordDTO | null>(null);
  const [adding, setAdding] = useState(false);
  /* Null when the drawer is closed. One piece of state for both trails, because
     there is one drawer -- opening an asset's history closes a record's. */
  const [history, setHistory] = useState<AuditSubject | null>(null);
  /* Equipment dialog: null = closed, 'new' = add, an asset = edit. */
  const [equipmentDialog, setEquipmentDialog] = useState<EquipmentDTO | 'new' | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [historyNonce, setHistoryNonce] = useState(0);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const canVerify = user ? VERIFIER_ROLES.includes(user.role) : false;
  const canManageEquipment = user ? EQUIPMENT_MANAGER_ROLES.includes(user.role) : false;

  /* On load, ask whether the cookie we may already hold is still valid, so a
     refresh does not force a fresh sign-in. */
  useEffect(() => {
    void (async () => {
      try {
        setUser((await api.me()).data);
      } catch {
        setUser(null);
      } finally {
        setCheckingSession(false);
      }
    })();
  }, []);

  /**
   * Loads one page of records.
   *
   * The server decides which page was actually served -- ask for page 9 of a
   * list that just shrank to 4 pages and it returns page 4 -- so the local
   * page number is corrected from the response rather than trusted. Without
   * that, the pager would highlight 9 above the contents of 4.
   */
  const loadPage = useCallback(
    async (equipmentId: string, status: CleaningStatus | 'all', wanted: number, size: number) => {
      setRecordsLoading(true);
      setRecordsError(null);
      try {
        const result = await api.listRecords(equipmentId, {
          page: wanted,
          pageSize: size,
          ...(status === 'all' ? {} : { status }),
        });
        setRecords(result.data);
        setPageInfo(result.pageInfo);
        if (result.pageInfo.page !== wanted) setPage(result.pageInfo.page);
      } catch (err) {
        setRecordsError(err);
        setRecords([]);
        setPageInfo(null);
      } finally {
        setRecordsLoading(false);
      }
    },
    [],
  );

  const loadReferenceData = useCallback(async () => {
    setEquipmentLoading(true);
    setEquipmentError(null);
    try {
      const [eq, us] = await Promise.all([api.listEquipment({ pageSize: 100 }), api.users()]);
      setEquipment(eq.data);
      setUsers(us.data);
      setSelected(
        (current) =>
          // Re-resolve rather than keeping the old object: a rename elsewhere
          // in the session would otherwise leave a stale name in the header.
          (current && eq.data.find((e) => e.id === current.id)) ??
          eq.data.find((e) => e.status === 'active') ??
          eq.data[0] ??
          null,
      );
    } catch (err) {
      setEquipmentError(err);
    } finally {
      setEquipmentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadReferenceData();
  }, [user, loadReferenceData]);

  const selectedId = selected?.id ?? null;

  useEffect(() => {
    if (!selectedId) return;

    // Close the drawer only if it belongs to something we are leaving: a
    // cleaning record of the previous asset, or another asset's history. An
    // asset's OWN history survives, which is what makes "add equipment, then
    // look at its audit trail" work -- selecting the new asset and opening its
    // history happen in the same tick, and an unconditional reset here closed
    // the drawer a moment after it opened.
    setHistory((h) => (h?.kind === 'equipment' && h.id === selectedId ? h : null));

    void loadPage(selectedId, filter, page, pageSize);
    // Keyed on the id, not the object: re-selecting the same asset after a
    // rename must not refetch the list and drop the user's place in it.
  }, [selectedId, filter, page, pageSize, loadPage]);

  /**
   * Changing the asset, the filter or the page size invalidates the page
   * number -- page 7 of one filter is not page 7 of another.
   *
   * Reset in the event handlers rather than in an effect, on purpose. As an
   * effect it would fire AFTER the render that changed the asset, so the load
   * effect has already run once with the stale page number: two requests, and
   * a flash of page 7 of the new asset before page 1 arrives. Batched into the
   * handler, both pieces of state change in one render and one request goes
   * out.
   */
  function selectEquipment(next: EquipmentDTO): void {
    setPage(1);
    setSelected(next);
  }

  /**
   * Refetches the current page after a mutation.
   *
   * Patching the row in place would be cheaper, but a numbered page has a
   * total and a position: verifying a record under the "pending" filter
   * removes it from the set, which moves the count and can empty the last
   * page. One round trip keeps the pager honest.
   */
  function refreshCurrentPage(): void {
    if (selectedId) void loadPage(selectedId, filter, page, pageSize);
    setHistoryNonce((n) => n + 1);
  }

  /** After an equipment write: patch it into the list in place, keep the
   *  selection pointing at the fresh object, and refresh any open history. */
  function applyEquipmentChange(saved: EquipmentDTO, created: boolean): void {
    setEquipment((prev) =>
      created
        ? [...prev, saved].sort((a, b) => a.code.localeCompare(b.code))
        : prev.map((e) => (e.id === saved.id ? saved : e)),
    );
    if (created) setPage(1); // a new asset starts at the top of an empty list
    setSelected((current) => (created || current?.id === saved.id ? saved : current));
    setHistoryNonce((n) => n + 1);
  }

  async function verify(record: CleaningRecordDTO): Promise<void> {
    setVerifyingId(record.id);
    setActionError(null);
    try {
      await api.updateRecord(record.id, { status: 'verified' });
      // Refetched rather than patched in place: under the "pending" filter the
      // record has just left the result set, which moves every total.
      refreshCurrentPage();
    } catch (err) {
      setActionError(err);
    } finally {
      setVerifyingId(null);
    }
  }

  async function signOut(): Promise<void> {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setEquipment([]);
      setRecords([]);
      setPageInfo(null);
      setSelected(null);
      setHistory(null);
      setEquipmentDialog(null);
    }
  }

  if (checkingSession) {
    return (
      <div className="boot">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (!user) return <LoginScreen onSignedIn={setUser} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="eyebrow">Equipment</span>
          <strong>Cleaning Log</strong>
        </div>
        <div className="whoami">
          <span className="muted small">
            {user.name} · <span className="mono">{user.role}</span>
          </span>
          <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="layout">
        <EquipmentSidebar
          equipment={equipment}
          loading={equipmentLoading}
          error={equipmentError}
          selectedId={selectedId}
          canManage={canManageEquipment}
          onSelect={selectEquipment}
          onAdd={() => setEquipmentDialog('new')}
          onEdit={(e) => setEquipmentDialog(e)}
          onRetry={() => void loadReferenceData()}
        />

        <main className="main">
          {actionError ? <ErrorBox error={actionError} /> : null}

          {selected ? (
            <RecordsTable
              equipment={selected}
              records={records}
              usersById={usersById}
              loading={recordsLoading}
              error={recordsError}
              pageInfo={pageInfo}
              filter={filter}
              canVerify={canVerify}
              selectedId={history?.kind === 'cleaning_record' ? history.id : null}
              verifyingId={verifyingId}
              assetHistoryOpen={history?.kind === 'equipment'}
              onFilterChange={(f) => {
                setPage(1);
                setFilter(f);
              }}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPage(1);
                setPageSize(size);
              }}
              onAdd={() => setAdding(true)}
              onEdit={setEditing}
              onVerify={(r) => void verify(r)}
              onShowHistory={(r) =>
                setHistory((h) =>
                  h?.kind === 'cleaning_record' && h.id === r.id
                    ? null
                    : {
                        kind: 'cleaning_record',
                        id: r.id,
                        label: `${selected.code} · cleaned ${formatDateTime(r.cleanedAt)}`,
                      },
                )
              }
              onShowAssetHistory={() =>
                setHistory((h) =>
                  h?.kind === 'equipment' && h.id === selected.id
                    ? null
                    : { kind: 'equipment', id: selected.id, label: `${selected.code} — ${selected.name}` },
                )
              }
              onRetry={() => refreshCurrentPage()}
            />
          ) : equipmentLoading ? null : (
            <ErrorBox error={new ApiError(0, 'no_equipment', 'No equipment found. Run `npm run seed`.')} />
          )}
        </main>

        {history ? (
          <AuditTrailPanel
            key={`${history.kind}:${history.id}:${historyNonce}`}
            subject={history}
            onClose={() => setHistory(null)}
          />
        ) : null}
      </div>

      {(adding || editing) && selected ? (
        <RecordFormDialog
          equipmentId={selected.id}
          record={editing}
          users={users}
          currentUser={user}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={(record) => {
            if (editing) {
              refreshCurrentPage();
            } else {
              // A new record is the newest, so it lands on page 1.
              setPage(1);
              void loadPage(selected.id, filter, 1, pageSize);
            }
            setAdding(false);
            setEditing(null);
            setHistory({
              kind: 'cleaning_record',
              id: record.id,
              label: `${selected.code} · cleaned ${formatDateTime(record.cleanedAt)}`,
            });
          }}
        />
      ) : null}

      {equipmentDialog ? (
        <EquipmentFormDialog
          equipment={equipmentDialog === 'new' ? null : equipmentDialog}
          onCancel={() => setEquipmentDialog(null)}
          onSaved={(saved, created) => {
            applyEquipmentChange(saved, created);
            setEquipmentDialog(null);
            setHistory({ kind: 'equipment', id: saved.id, label: `${saved.code} — ${saved.name}` });
          }}
        />
      ) : null}
    </div>
  );
}
