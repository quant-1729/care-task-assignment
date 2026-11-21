// Fixed values shared by the schema, the rules and the API.

export const SPECIALTIES = [
  { key: 'icu', label: 'Critical care (ICU)' },
  { key: 'cardiac', label: 'Cardiac' },
  { key: 'paediatrics', label: 'Paediatrics' },
  { key: 'wound_care', label: 'Wound care' },
  { key: 'iv_medication', label: 'IV and medication' },
];

export const STATUSES = [
  { key: 'new', label: 'New' },
  { key: 'finding', label: 'Finding a nurse' },
  { key: 'offered', label: 'Offered' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'done', label: 'Done' },
  { key: 'needs_attention', label: 'Needs attention' },
  { key: 'cancelled', label: 'Cancelled' },
];

export const ATTENTION_REASONS = [
  { key: 'no_nurse', label: 'No nurse available' },
  { key: 'declined', label: 'Nurse declined' },
  { key: 'failed', label: 'Failed before starting' },
  { key: 'taking_too_long', label: 'Taking too long' },
  { key: 'restart', label: 'Interrupted by restart' },
];

export const PRIORITIES = ['urgent', 'routine'];
export const ACTORS = ['system', 'head_nurse', 'nurse', 'server'];

export const EVENT_KINDS = [
  'created',
  'request_sent',
  'offered',
  'no_nurse',
  'taking_too_long',
  'accepted',
  'declined',
  'offer_timeout',
  'failed',
  'done',
  'retry',
  'assigned_by_hand',
  'cancelled',
  'late_answer_ignored',
  'action_rejected',
  'restart_interrupted',
];

// Events that put a nurse on a task's "do not offer again" list.
export const EXCLUDING_EVENT_KINDS = ['declined', 'offer_timeout', 'failed'];

export const DEMO_MODES = ['never', 'no_nurse', 'fast', 'slow'];

export const WORKLOAD_LIMIT = 12;
export const WARN_AFTER_MS = { urgent: 25000, routine: 30000 };
export const OFFER_TIMEOUT_MS = 60000;

export const keys = (list) => list.map((x) => (typeof x === 'string' ? x : x.key));

export const statusLabel = (key) => STATUSES.find((s) => s.key === key)?.label ?? key;
export const specialtyLabel = (key) => SPECIALTIES.find((s) => s.key === key)?.label ?? key;
