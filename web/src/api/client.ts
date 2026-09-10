import type {
  ApiErrorBody,
  AuditEventDTO,
  CleaningRecordDTO,
  CleaningStatus,
  CreateCleaningRecordRequest,
  CreateEquipmentRequest,
  EquipmentDTO,
  EquipmentStatus,
  LoginRequest,
  Page,
  Single,
  UpdateCleaningRecordRequest,
  UpdateEquipmentRequest,
  UserDTO,
} from '../../../shared/contract.ts';

/**
 * Carries the API's error envelope through to the UI intact, so a form can
 * attach `details` to the field that caused them instead of showing one
 * generic message.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The message for one field, if the server named it. */
  forField(path: string): string | undefined {
    return this.details.find((d) => d.path === path)?.message;
  }
}

const BASE = '/api';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      // Send the session cookie. Vite proxies /api to the Express server, so
      // this is same-origin in development as well as in production.
      credentials: 'same-origin',
      headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    // fetch only rejects for network-level failures, so this is genuinely
    // "the server is not there" rather than any HTTP status.
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Is the API running?');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? `Request failed with status ${res.status}.`,
      err?.details ?? [],
    );
  }

  return body as T;
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  /* auth */
  login: (body: LoginRequest) =>
    call<Single<UserDTO>>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => call<void>('/auth/logout', { method: 'POST' }),
  me: () => call<Single<UserDTO>>('/auth/me'),
  users: () => call<Single<UserDTO[]>>('/auth/users'),

  /* equipment */
  listEquipment: (params: { status?: EquipmentStatus; page?: number; pageSize?: number } = {}) =>
    call<Page<EquipmentDTO>>(`/equipment${qs(params)}`),

  createEquipment: (body: CreateEquipmentRequest) =>
    call<Single<EquipmentDTO>>('/equipment', { method: 'POST', body: JSON.stringify(body) }),

  updateEquipment: (id: string, body: UpdateEquipmentRequest) =>
    call<Single<EquipmentDTO>>(`/equipment/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** DELETE retires the asset; the server returns the updated row, not 204. */
  retireEquipment: (id: string) =>
    call<Single<EquipmentDTO>>(`/equipment/${id}`, { method: 'DELETE' }),

  equipmentAudit: (id: string, params: { page?: number; pageSize?: number } = {}) =>
    call<Page<AuditEventDTO>>(`/equipment/${id}/audit${qs(params)}`),

  /* cleaning records */
  listRecords: (
    equipmentId: string,
    params: { status?: CleaningStatus; page?: number; pageSize?: number } = {},
  ) => call<Page<CleaningRecordDTO>>(`/equipment/${equipmentId}/cleaning-records${qs(params)}`),

  createRecord: (equipmentId: string, body: CreateCleaningRecordRequest) =>
    call<Single<CleaningRecordDTO>>(`/equipment/${equipmentId}/cleaning-records`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateRecord: (recordId: string, body: UpdateCleaningRecordRequest) =>
    call<Single<CleaningRecordDTO>>(`/cleaning-records/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  auditHistory: (recordId: string, params: { page?: number; pageSize?: number } = {}) =>
    call<Page<AuditEventDTO>>(`/cleaning-records/${recordId}/audit${qs(params)}`),
};
