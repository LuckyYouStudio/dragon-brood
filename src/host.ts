import { connectGameToHost, observeGameContentSize } from './sdk/guest';
import type { HostApiV1, HostSnapshotV1 } from './sdk/guest';

export type Mode = 'connecting' | 'live' | 'demo';

export type HostLink = {
  mode: Mode;
  api: HostApiV1 | null;
  snapshot: HostSnapshotV1 | null;
};

/** How long to wait for a casino host before the page turns into the playable demo. */
const HANDSHAKE_GRACE_MS = 2500;

/**
 * Guest side of the casino bridge. Inside the Chain.wtf host (or the local simulator) the
 * handshake resolves and the game goes live. Opened directly — or framed by a page that is not
 * a casino host — it becomes a self-contained demo with play money and the same paytable.
 */
export function connectHost(onChange: (link: HostLink) => void): HostLink {
  const link: HostLink = { mode: 'connecting', api: null, snapshot: null };
  const framed = window.parent !== window;

  if (!framed) {
    link.mode = 'demo';
    queueMicrotask(() => onChange(link));
    return link;
  }

  // One connection per page: the host binds its guest proxy to the first handshake.
  const connection = connectGameToHost({
    async setState(snapshot) {
      link.snapshot = snapshot;
      onChange(link);
    },
  });

  const fallback = window.setTimeout(() => {
    if (link.mode === 'connecting') {
      link.mode = 'demo';
      onChange(link);
    }
  }, HANDSHAKE_GRACE_MS);

  void connection.promise
    .then(api => {
      window.clearTimeout(fallback);
      link.api = api;
      link.mode = 'live';
      observeGameContentSize(api);
      onChange(link);
    })
    .catch(() => {
      // No host answered; the demo fallback takes over.
    });

  window.addEventListener('pagehide', () => connection.destroy());
  return link;
}
