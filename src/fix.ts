import type { WmeSDK } from "wme-sdk-typings";
import { t } from "./i18n";
import { log } from "./log";
import type { Issue } from "./matching/evaluate";
import type { Settings } from "./settings";

export const GROUP_FIX_CAP = 50;
export const GROUP_FIX_CONFIRM_THRESHOLD = 20;

/** Error codes double as i18n string keys (see src/i18n.ts). */
export type FixErrorCode =
  | "errNotFixable"
  | "errEditingNotAllowed"
  | "errSegmentUnloaded"
  | "errNoCity"
  | "errStreetCreate";

export interface FixOutcome {
  segmentId: number;
  ok: boolean;
  errorCode?: FixErrorCode;
  /** Raw message for unexpected SDK errors (not localized). */
  errorDetail?: string;
}

export function formatFixError(outcome: FixOutcome): string {
  if (outcome.errorCode) return t(outcome.errorCode);
  return outcome.errorDetail ?? "?";
}

/**
 * Apply the suggested official name to a segment: find or create the Street
 * record in the segment's city, then update the segment's primary address.
 * Never saves; the editor reviews and saves with the native WME flow.
 */
export function fixSegment(sdk: WmeSDK, issue: Issue, settings: Settings): FixOutcome {
  const segmentId = issue.segmentId;
  const fail = (errorCode: FixErrorCode): FixOutcome => ({ segmentId, ok: false, errorCode });

  if (!issue.fixable || !issue.suggestion) return fail("errNotFixable");
  if (!sdk.Editing.isEditingAllowed()) return fail("errEditingNotAllowed");

  try {
    const segment = sdk.DataModel.Segments.getById({ segmentId });
    if (!segment) return fail("errSegmentUnloaded");
    const address = sdk.DataModel.Segments.getAddress({ segmentId });
    const cityId = address.city?.id;
    if (cityId == null) return fail("errNoCity");

    let street = sdk.DataModel.Streets.getStreet({ streetName: issue.suggestion, cityId });
    if (!street) {
      try {
        street = sdk.DataModel.Streets.addStreet({ streetName: issue.suggestion, cityId });
      } catch {
        street = sdk.DataModel.Streets.getStreet({ streetName: issue.suggestion, cityId });
      }
    }
    if (!street) return fail("errStreetCreate");
    // Already correct (stale list, repeated group fix): no empty edit.
    if (segment.primaryStreetId === street.id) return { segmentId, ok: true };

    // Alternates must be passed back explicitly so they are preserved.
    const alternateStreetIds = [...segment.alternateStreetIds];
    if (
      settings.keepOldNameAsAlt &&
      issue.status !== "NEAR" && // never keep a typo as alternate
      segment.primaryStreetId != null &&
      segment.primaryStreetId !== street.id &&
      !alternateStreetIds.includes(segment.primaryStreetId)
    ) {
      alternateStreetIds.push(segment.primaryStreetId);
    }

    sdk.DataModel.Segments.updateAddress({
      segmentId,
      primaryStreetId: street.id,
      alternateStreetIds,
    });
    return { segmentId, ok: true };
  } catch (err) {
    log.error(`Fix failed for segment ${segmentId}`, err);
    return {
      segmentId,
      ok: false,
      errorDetail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sequential group fix; stops at the first error. Hard-capped.
 * Yields to the event loop between segments so the UI can repaint progress.
 */
export async function fixGroup(
  sdk: WmeSDK,
  issues: Issue[],
  settings: Settings,
  onProgress?: (done: number, total: number) => void,
): Promise<FixOutcome[]> {
  const outcomes: FixOutcome[] = [];
  const batch = issues.slice(0, GROUP_FIX_CAP);
  for (const issue of batch) {
    const outcome = fixSegment(sdk, issue, settings);
    outcomes.push(outcome);
    onProgress?.(outcomes.length, batch.length);
    if (!outcome.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return outcomes;
}

let fixInFlight = false;

export function isFixInFlight(): boolean {
  return fixInFlight;
}

/**
 * Re-entrance guard shared by every fix button (sidebar tab, edit-panel box,
 * shortcuts): while one application runs, further fix clicks are ignored.
 * Returns null when the lock is already held.
 */
export async function withFixLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (fixInFlight) return null;
  fixInFlight = true;
  try {
    return await fn();
  } finally {
    fixInFlight = false;
  }
}
