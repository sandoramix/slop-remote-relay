/**
 * Episode navigation, as data plus a little pure logic.
 *
 * A site's plan lives in sites.json under "nav" and says where the page keeps
 * its list of episodes (or its own previous/next buttons). Nothing here knows
 * about any particular site: supporting one more is a JSON entry, and when a
 * site changes its markup the fix is a selector, not a release of code.
 */

export interface NavPlan {
  /** Regex on the page's path; the plan applies only where it matches. Default: everywhere on the site. */
  paths?: string;
  /**
   * CSS selector for every entry of the series, in order. Select all of them,
   * including those a "1 - 50" range tab hides: the DOM order is the order.
   */
  items?: string;
  /** Attribute holding an entry's label ("data-episode-num"), or "text" (the default). */
  label?: string;
  /** Selector that matches the current entry among `items`. Without it, the entry whose link is the page's own. */
  current?: string;
  /** Selectors of the page's own previous/next controls, for sites with no list to read. */
  next?: string;
  prev?: string;
}

export interface NavEntry {
  label: string;
  /** Absolute link, when the entry is one. */
  href: string | null;
  current: boolean;
}

export const planApplies = (plan: { paths?: string }, pathname: string): boolean => {
  if (!plan.paths) return true;
  try {
    return new RegExp(plan.paths).test(pathname);
  } catch {
    return false;
  }
};

/** The current entry: the one marked so, else the one whose link is the page. */
export function currentIndex(entries: NavEntry[], pageUrl: string): number | null {
  const marked = entries.findIndex((e) => e.current);
  if (marked >= 0) return marked;
  const sameUrl = (a: string) => a.split('#')[0] === pageUrl.split('#')[0];
  const byUrl = entries.findIndex((e) => e.href !== null && sameUrl(e.href));
  return byUrl >= 0 ? byUrl : null;
}

/** Where a step lands, or null at either end of the list or when the current entry is unknown. */
export function stepIndex(count: number, current: number | null, delta: 1 | -1): number | null {
  if (current === null) return null;
  const next = current + delta;
  return next >= 0 && next < count ? next : null;
}
