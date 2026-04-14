import type { AppInstance } from '@/types/api';

const PREFERRED_INSTANCE_STORAGE_KEY = 'muti-agent:preferred-instance-id';
const DEMO_LIKE_PATTERN = /\b(smoke|demo|sample|example|mock)\b/i;

function readPreferredInstanceId() {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.localStorage.getItem(PREFERRED_INSTANCE_STORAGE_KEY) || '';
}

function getInstanceScore(instance: AppInstance, preferredInstanceId: string) {
  const searchableText = [
    instance.name,
    instance.code,
    instance.appType,
    instance.adapterType,
    instance.launchCommand,
    instance.executablePath || ''
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;

  if (preferredInstanceId && instance.id === preferredInstanceId) {
    score += 1000;
  }
  if (instance.adapterType === 'codex-cli') {
    score += 240;
  }
  if ((instance.appType || '').toLowerCase() === 'codex') {
    score += 160;
  }
  if (searchableText.includes('codex')) {
    score += 120;
  }
  if (DEMO_LIKE_PATTERN.test(searchableText)) {
    score -= 200;
  }

  return score;
}

function compareIsoTimeDesc(left?: string | null, right?: string | null) {
  return (right || '').localeCompare(left || '');
}

export function sortInstancesByPreference(instances: AppInstance[]) {
  const preferredInstanceId = readPreferredInstanceId();
  return [...instances].sort((left, right) => {
    const scoreDiff = getInstanceScore(right, preferredInstanceId) - getInstanceScore(left, preferredInstanceId);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const lastStartDiff = compareIsoTimeDesc(left.lastStartAt, right.lastStartAt);
    if (lastStartDiff !== 0) {
      return lastStartDiff;
    }

    const updatedAtDiff = compareIsoTimeDesc(left.updatedAt, right.updatedAt);
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }

    return compareIsoTimeDesc(left.createdAt, right.createdAt);
  });
}

export function pickPreferredInstanceId(instances: AppInstance[]) {
  return sortInstancesByPreference(instances)[0]?.id ?? '';
}

export function rememberPreferredInstance(instanceId: string) {
  if (typeof window === 'undefined' || !instanceId) {
    return;
  }
  window.localStorage.setItem(PREFERRED_INSTANCE_STORAGE_KEY, instanceId);
}
